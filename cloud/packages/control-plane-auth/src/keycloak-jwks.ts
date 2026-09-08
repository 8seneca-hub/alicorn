import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'

// Why: a key-rotation storm must not become one outbound fetch per request. `cooldownDuration`
// is the hard floor between refetches when an unknown `kid` arrives; `cacheMaxAge` bounds how
// stale a cached key set may get. Both are set explicitly rather than left to jose's defaults.
export const JWKS_CACHE_MAX_AGE_MS = 600_000
export const JWKS_COOLDOWN_MS = 30_000
const JWKS_TIMEOUT_MS = 5_000

export function keycloakJwksUri(issuer: string): string {
  return `${issuer}/protocol/openid-connect/certs`
}

// Loopback cannot leave the machine, so plaintext there is not a transport risk.
function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

export function assertJwksTransportAllowed(uri: string, allowInsecureHttp: boolean): void {
  const url = new URL(uri)
  if (url.protocol === 'https:') return
  if (isLoopback(url.hostname)) return
  if (allowInsecureHttp) return
  throw new Error(
    `refusing to fetch JWKS over ${url.protocol}//${url.hostname} — set ALICORN_KEYCLOAK_ALLOW_INSECURE_JWKS=true only for a trusted private network`
  )
}

export function createKeycloakJwks(input: { issuer: string; allowInsecureHttp: boolean }): JWTVerifyGetKey {
  const uri = keycloakJwksUri(input.issuer)
  assertJwksTransportAllowed(uri, input.allowInsecureHttp)
  return createRemoteJWKSet(new URL(uri), {
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    timeoutDuration: JWKS_TIMEOUT_MS
  })
}
