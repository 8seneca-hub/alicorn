import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { readBearer, type KeycloakAccessClaims } from '@alicorn-cloud/control-plane-auth'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { NotAMemberError, type DesktopIdentityRecord } from './desktop-identity-store.js'
import { buildDesktopContextResponse, buildDesktopSessionResponse } from './desktop-session-response.js'
import { KeycloakTokenError, type KeycloakTokens } from './keycloak-token-client.js'
import { readJsonBody } from './read-json-body.js'

// The broker for the desktop's *existing* Orca Cloud sign-in flow. Paths, request bodies and
// response shapes come from src/main/orca-profiles/{profile-cloud-auth-config,profile-cloud-client}.ts
// — no desktop auth code changes, so nothing here is ours to redesign.
//
// These routes sit *before* `app.use('/v1/*', requireTenant)` so they are exempt from it: the
// desktop has no `x-alicorn-org` to send until this exchange tells it which organisations exist.
// They authenticate themselves instead — `session`/`refresh` by the code or refresh token
// Keycloak accepts, the rest by verifying the presented access token here.

const SessionBodySchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  redirectUri: z.string().url(),
  state: z.string().min(1),
  localProfileId: z.string().min(1)
})

const RefreshBodySchema = z.object({ refreshToken: z.string().min(1) })
const OrgBodySchema = z.object({ orgId: z.string().min(1) })
const LogoutBodySchema = z.object({ refreshToken: z.string().min(1) })

type BrokerDeps = ControlApiDeps & {
  verifyAccessToken: NonNullable<ControlApiDeps['verifyAccessToken']>
  verifyIdToken: NonNullable<ControlApiDeps['verifyIdToken']>
  tokenClient: NonNullable<ControlApiDeps['tokenClient']>
  identityStore: NonNullable<ControlApiDeps['identityStore']>
}

export function registerDesktopAuthRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  const paths = [
    '/v1/desktop/auth/session',
    '/v1/desktop/auth/refresh',
    '/v1/desktop/auth/capabilities',
    '/v1/desktop/auth/org',
    '/v1/desktop/auth/profile',
    '/v1/desktop/auth/logout'
  ]
  if (deps.config.auth.authMode !== 'keycloak') {
    // Tier 1 runs mode `local`, where there is no sign-in to broker and the shared token is the
    // whole story. Answering 404 keeps these paths off the authenticated surface entirely.
    for (const path of paths) app.post(path, (c) => c.json({ error: 'not_available_in_local_mode' }, 404))
    return
  }
  if (!deps.verifyAccessToken || !deps.verifyIdToken || !deps.tokenClient || !deps.identityStore) {
    // Fail at construction, not at the first sign-in, where it would look like a token problem.
    throw new Error('keycloak mode requires verifyAccessToken, verifyIdToken, tokenClient and identityStore')
  }
  const broker = deps as BrokerDeps
  const now = (): number => (deps.now ?? Date.now)()

  app.post('/v1/desktop/auth/session', (c) => handleSession(c, broker, now()))
  app.post('/v1/desktop/auth/refresh', (c) => handleRefresh(c, broker, now()))
  app.post('/v1/desktop/auth/capabilities', (c) => handleCapabilities(c, broker, now()))
  app.post('/v1/desktop/auth/org', (c) => handleOrg(c, broker, now()))
  // Multi-profile is not built; the desktop treats any non-2xx here as "cannot create".
  app.post('/v1/desktop/auth/profile', (c) => c.json({ error: 'not_implemented' }, 501))
  app.post('/v1/desktop/auth/logout', (c) => handleLogout(c, broker))
}

async function handleSession(c: Context<ControlApiEnv>, deps: BrokerDeps, at: number): Promise<Response> {
  const body = await parseBody(c, SessionBodySchema)
  if (!body) return c.json({ error: 'invalid_body' }, 400)

  let tokens: KeycloakTokens
  try {
    tokens = await deps.tokenClient.exchangeCode({
      code: body.code,
      codeVerifier: body.codeVerifier,
      redirectUri: body.redirectUri
    })
  } catch (error) {
    return rejectedExchange(c, error, 'exchange_rejected')
  }

  const claims = await deps.verifyAccessToken(tokens.accessToken)
  // Our own realm minted this a millisecond ago; if we cannot verify it, the deployment is
  // misconfigured (wrong issuer, wrong client) rather than the caller being unauthorised.
  if (!claims) return c.json({ error: 'token_unverifiable' }, 502)

  // Why enforced rather than best-effort: the nonce is the only thing binding this code to the
  // authorization request the desktop started, and the desktop always requests `openid`.
  if (!tokens.idToken) return c.json({ error: 'id_token_missing' }, 502)
  const idClaims = await deps.verifyIdToken(tokens.idToken)
  if (!idClaims || idClaims.sub !== claims.sub) return c.json({ error: 'token_unverifiable' }, 502)
  if (idClaims.nonce !== body.nonce) return c.json({ error: 'nonce_mismatch' }, 400)

  const identity = await deps.identityStore.linkSession({ claims, localProfileId: body.localProfileId })
  return c.json(buildDesktopSessionResponse({ tokens, identity, now: at }), 200)
}

async function handleRefresh(c: Context<ControlApiEnv>, deps: BrokerDeps, at: number): Promise<Response> {
  const body = await parseBody(c, RefreshBodySchema)
  if (!body) return c.json({ error: 'invalid_body' }, 400)

  let tokens: KeycloakTokens
  try {
    tokens = await deps.tokenClient.refresh({ refreshToken: body.refreshToken })
  } catch (error) {
    return rejectedExchange(c, error, 'refresh_rejected')
  }

  // The whole context is rebuilt from the *new* token's claims, so a refresh can only ever
  // return the organisations that token proves — it cannot launder a session into another org.
  const claims = await deps.verifyAccessToken(tokens.accessToken)
  if (!claims) return c.json({ error: 'token_unverifiable' }, 502)

  const identity = await deps.identityStore.resumeSession({ claims })
  return c.json(buildDesktopSessionResponse({ tokens, identity, now: at }), 200)
}

async function handleCapabilities(c: Context<ControlApiEnv>, deps: BrokerDeps, at: number): Promise<Response> {
  const claims = await bearerClaims(c, deps)
  if (!claims) return c.json({ error: 'unauthorized' }, 401)
  const identity = await deps.identityStore.resumeSession({ claims })
  return c.json(buildDesktopContextResponse(identity, at), 200)
}

async function handleOrg(c: Context<ControlApiEnv>, deps: BrokerDeps, at: number): Promise<Response> {
  const claims = await bearerClaims(c, deps)
  if (!claims) return c.json({ error: 'unauthorized' }, 401)
  const body = await parseBody(c, OrgBodySchema)
  if (!body) return c.json({ error: 'invalid_body' }, 400)

  let identity: DesktopIdentityRecord
  try {
    // Membership is decided by the presented token's `organization` claim, never by the header
    // or by anything the store remembers.
    identity = await deps.identityStore.selectOrganization({ claims, orgId: body.orgId })
  } catch (error) {
    if (error instanceof NotAMemberError) return c.json({ error: 'not_a_member' }, 403)
    throw error
  }
  return c.json(buildDesktopContextResponse(identity, at), 200)
}

async function handleLogout(c: Context<ControlApiEnv>, deps: BrokerDeps): Promise<Response> {
  const claims = await bearerClaims(c, deps)
  if (!claims) return c.json({ error: 'unauthorized' }, 401)
  const body = await parseBody(c, LogoutBodySchema)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  await deps.tokenClient.logout({ refreshToken: body.refreshToken })
  // Why 200 `{}` and not 204: the desktop's `postJson` calls `response.json()` on every 2xx,
  // so an empty body would make a successful sign-out throw.
  return c.json({}, 200)
}

async function bearerClaims(
  c: Context<ControlApiEnv>,
  deps: BrokerDeps
): Promise<KeycloakAccessClaims | null> {
  const bearer = readBearer(c.req.header('authorization'))
  return bearer ? deps.verifyAccessToken(bearer) : null
}

async function parseBody<T extends z.ZodTypeAny>(c: Context<ControlApiEnv>, schema: T): Promise<z.infer<T> | null> {
  const body = await readJsonBody(c)
  if (!body.ok) return null
  const parsed = schema.safeParse(body.value)
  return parsed.success ? parsed.data : null
}

function rejectedExchange(c: Context<ControlApiEnv>, error: unknown, code: string): Response {
  if (error instanceof KeycloakTokenError) {
    // `code` is Keycloak's stable OAuth error (invalid_grant, …); nothing token-bearing travels.
    return c.json({ error: code, code: error.errorCode }, 401)
  }
  // A transport failure is ours, not the caller's — and the desktop retries a 5xx refresh once.
  return c.json({ error: 'idp_unreachable' }, 502)
}
