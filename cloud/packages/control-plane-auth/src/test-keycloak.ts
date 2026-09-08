import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type JWTVerifyGetKey } from 'jose'

// Why: an in-process Keycloak stand-in so the auth boundary is covered by real signature
// verification without Docker. Exported from the package because both apps' tests need it.

export type TestKeycloak = {
  issuer: string
  clientId: string
  getKey: JWTVerifyGetKey
  publicJwk: JWK
  sign(claims: Record<string, unknown>, opts?: { expiresIn?: string; audience?: string; issuer?: string; alg?: string }): Promise<string>
}

const KID = 'test-key-1'

export async function createTestKeycloak(input: { issuer: string; clientId: string }): Promise<TestKeycloak> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  return {
    issuer: input.issuer,
    clientId: input.clientId,
    publicJwk,
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    async sign(claims, opts) {
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: opts?.alg ?? 'RS256', kid: KID })
        .setIssuedAt()
        .setIssuer(opts?.issuer ?? input.issuer)
        .setExpirationTime(opts?.expiresIn ?? '5m')
      if (opts?.audience) jwt.setAudience(opts.audience)
      return jwt.sign(privateKey)
    }
  }
}

export type TestTokenResponse =
  | { accessTokenClaims?: Record<string, unknown>; idTokenClaims?: Record<string, unknown>; expiresIn?: number }
  | { error: { status: number; code: string } }

export type TestKeycloakServer = {
  issuer: string
  keycloak: TestKeycloak
  requests: Array<{ path: string; body: Record<string, string> }>
  setTokenResponse(next: TestTokenResponse): void
  close(): Promise<void>
}

const DEFAULT_TOKEN_RESPONSE: TestTokenResponse = {}

export async function startTestKeycloakServer(input: { clientId: string; realm?: string }): Promise<TestKeycloakServer> {
  const realm = input.realm ?? 'alicorn'
  const requests: Array<{ path: string; body: Record<string, string> }> = []
  let tokenResponse: TestTokenResponse = DEFAULT_TOKEN_RESPONSE
  let server: Server | undefined

  const listener = createServer((req, res) => {
    void handle(req, res)
  })
  server = listener
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as AddressInfo).port
  const issuer = `http://127.0.0.1:${port}/realms/${realm}`
  const keycloak = await createTestKeycloak({ issuer, clientId: input.clientId })

  async function handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const raw = await readBody(req)
    requests.push({ path, body: Object.fromEntries(new URLSearchParams(raw)) })

    if (path === `/realms/${realm}/.well-known/openid-configuration`) {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
        code_challenge_methods_supported: ['S256']
      })
    }
    if (path === `/realms/${realm}/protocol/openid-connect/certs`) {
      return json(res, 200, { keys: [keycloak.publicJwk] })
    }
    if (path === `/realms/${realm}/protocol/openid-connect/token`) {
      if ('error' in tokenResponse) {
        return json(res, tokenResponse.error.status, { error: tokenResponse.error.code })
      }
      const expiresIn = tokenResponse.expiresIn ?? 300
      const accessToken = await keycloak.sign({
        sub: 'kc-sub-1',
        azp: input.clientId,
        typ: 'Bearer',
        email: 'dev@acme.test',
        name: 'Dev User',
        preferred_username: 'dev',
        organization: { acme: { id: 'org-acme' } },
        ...tokenResponse.accessTokenClaims
      })
      const idToken = await keycloak.sign(
        {
          sub: 'kc-sub-1',
          azp: input.clientId,
          typ: 'ID',
          ...tokenResponse.idTokenClaims
        },
        // Keycloak addresses an ID token to the client, so the broker's ID-token verifier checks `aud`.
        { audience: input.clientId }
      )
      return json(res, 200, {
        access_token: accessToken,
        refresh_token: 'test-refresh-token',
        id_token: idToken,
        expires_in: expiresIn,
        token_type: 'Bearer'
      })
    }
    if (path === `/realms/${realm}/protocol/openid-connect/logout`) {
      res.writeHead(204).end()
      return
    }
    return json(res, 404, { error: 'not_found' })
  }

  return {
    issuer,
    keycloak,
    requests,
    setTokenResponse(next) {
      tokenResponse = next
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' }).end(payload)
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
