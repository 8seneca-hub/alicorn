import { jwtVerify, type JWTVerifyGetKey } from 'jose'
import { KeycloakAccessClaimsSchema, type KeycloakAccessClaims } from './keycloak-claims.js'

// Why: pinned so a token can never select `none` or an algorithm the realm does not sign with.
const ACCEPTED_ALGORITHMS = ['RS256', 'ES256'] as const

export type KeycloakAccessTokenVerifier = (token: string) => Promise<KeycloakAccessClaims | null>

export function createKeycloakAccessTokenVerifier(input: {
  getKey: JWTVerifyGetKey
  issuer: string
  clientId: string
}): KeycloakAccessTokenVerifier {
  return async (token) => {
    let payload: unknown
    try {
      // jwtVerify checks signature, `iss`, `exp` and `nbf`; without `issuer` any Keycloak would pass.
      ;({ payload } = await jwtVerify(token, input.getKey, {
        issuer: input.issuer,
        algorithms: [...ACCEPTED_ALGORITHMS]
      }))
    } catch {
      // Why: never log — the message can carry the token or its claims.
      return null
    }
    const parsed = KeycloakAccessClaimsSchema.safeParse(payload)
    if (!parsed.success) return null
    // Keycloak's `aud` on an access token is the resource server (often `account`), so the
    // authorised party is what identifies the client the token was actually issued to.
    if (parsed.data.azp !== input.clientId) return null
    // Why: an ID token from the same realm has the same `iss`/`azp` and would otherwise verify.
    const typ = (payload as { typ?: unknown }).typ
    if (typeof typ === 'string' && typ !== 'Bearer') return null
    return parsed.data
  }
}
