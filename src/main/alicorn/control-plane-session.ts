import { getOrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import { readFreshOrcaCloudSession } from '../orca-profiles/profile-cloud-session-refresh'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'

export type AlicornBearer = {
  accessToken: string
  orgId: string
}

/** Mirrors the services' own `ALICORN_AUTH_MODE`; a stack and its desktop must agree. */
export type AlicornAuthMode = 'local' | 'keycloak'

// A token this short is a placeholder or a truncated paste, not a credential;
// rejecting it here turns a confusing 401 into "not configured".
const MIN_ACCESS_TOKEN_LENGTH = 16

const DEFAULT_ORG_ID = 'local'

/**
 * Which credential the desktop presents. Declaring `ALICORN_AUTH_MODE` — the same variable
 * the two services read — is what stops a desktop and a stack disagreeing by accident. With
 * it unset the shared token decides, so every tier-1 setup keeps working untouched.
 *
 * Note the asymmetry: `keycloak` never falls back to the shared token, and `local` never
 * reaches for a signed-in session. A mode that quietly borrowed the other's credential would
 * present a token the server cannot place — which reads as a broken deployment, not as
 * "sign in".
 */
export function resolveAlicornAuthMode(env: NodeJS.ProcessEnv): AlicornAuthMode {
  const declared = env.ALICORN_AUTH_MODE?.trim()
  if (declared === 'keycloak' || declared === 'local') {
    return declared
  }
  return env.ALICORN_LOCAL_API_TOKEN?.trim() ? 'local' : 'keycloak'
}

function readLocalBearer(env: NodeJS.ProcessEnv): AlicornBearer | null {
  const accessToken = env.ALICORN_LOCAL_API_TOKEN?.trim()
  if (!accessToken || accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
    return null
  }
  return {
    accessToken,
    orgId: env.ALICORN_TENANT_ID?.trim() || DEFAULT_ORG_ID
  }
}

async function readKeycloakBearer(
  env: NodeJS.ProcessEnv,
  resolveUserDataPath: () => string
): Promise<AlicornBearer | null> {
  const auth = getOrcaCloudAuthConfig(env)
  // Why first: an unconfigured build has no session store worth consulting, and this keeps the
  // whole keycloak path off the profile layer for local-mode installs and tests.
  if (!auth.configured) {
    return null
  }
  const userDataPath = resolveUserDataPath()
  const active = ensureActiveOrcaProfile(userDataPath)
  // Why the profile and never ALICORN_TENANT_ID: `x-alicorn-org` is a cross-check the control
  // plane runs against the token's own `organization` claim, so it has to come from the same
  // session the token does. An env-supplied org would be a header the token cannot prove.
  const orgId = active.profile.cloud?.activeOrgId?.trim()
  if (!orgId) {
    return null
  }
  const session = await readFreshOrcaCloudSession(auth.config, active, userDataPath)
  if (session.status !== 'found') {
    return null
  }
  // Why re-read after the refresh: a refresh or an org switch can rewrite cloud linkage while
  // this call is in flight (the hazard readRelayAuthContext already guards). Pairing the new
  // token with the org read before it is exactly the disagreement the server answers with 403.
  const refreshed = ensureActiveOrcaProfile(userDataPath)
  if (
    refreshed.profile.id !== active.profile.id ||
    refreshed.profile.cloud?.activeOrgId?.trim() !== orgId
  ) {
    return null
  }
  return { accessToken: session.session.accessToken, orgId }
}

/**
 * The single point where the desktop decides what goes in `authorization` and `x-alicorn-org`.
 * `alicornFetch` is its only request-path caller, so no other module can attach a credential.
 *
 * The token never leaves the main process: in `local` mode it is main's own environment, and in
 * `keycloak` mode it is the Alicorn Cloud session on disk, which a worker terminal has no reader
 * for. Nothing here writes either into a launch environment.
 */
export async function readAlicornBearer(
  env: NodeJS.ProcessEnv,
  userDataPath?: string
): Promise<AlicornBearer | null> {
  if (resolveAlicornAuthMode(env) === 'local') {
    return readLocalBearer(env)
  }
  return readKeycloakBearer(env, () => userDataPath ?? getProfileUserDataPath())
}

/**
 * Startup's synchronous question: could this desktop produce a bearer at all? In `keycloak`
 * mode being *signed in* needs disk and network, so this answers the build-level question only
 * and a signed-out call fails at the request instead — which is where the user can act on it.
 */
export function isAlicornBearerConfigured(env: NodeJS.ProcessEnv): boolean {
  return resolveAlicornAuthMode(env) === 'local'
    ? readLocalBearer(env) !== null
    : getOrcaCloudAuthConfig(env).configured
}
