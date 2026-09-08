import { jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'

// Why a second verifier: the access-token verifier deliberately rejects `typ: 'ID'` so an ID
// token can never be presented as a bearer. The code-exchange broker still has to read the ID
// token's `nonce` to bind the sign-in to the authorization request it started — and reading it
// with an unverified decode would let anyone who can reach the broker choose that nonce.

const ACCEPTED_ALGORITHMS = ['RS256', 'ES256'] as const

const KeycloakIdClaimsSchema = z.object({
  sub: z.string().min(1),
  nonce: z.string().min(1).optional()
})

export type KeycloakIdClaims = z.infer<typeof KeycloakIdClaimsSchema>
export type KeycloakIdTokenVerifier = (token: string) => Promise<KeycloakIdClaims | null>

export function createKeycloakIdTokenVerifier(input: {
  getKey: JWTVerifyGetKey
  issuer: string
  clientId: string
}): KeycloakIdTokenVerifier {
  return async (token) => {
    let payload: unknown
    try {
      // An ID token's `aud` *is* the client, unlike an access token's, so it is checked here.
      ;({ payload } = await jwtVerify(token, input.getKey, {
        issuer: input.issuer,
        audience: input.clientId,
        algorithms: [...ACCEPTED_ALGORITHMS]
      }))
    } catch {
      // Why: never log — the message can carry the token or its claims.
      return null
    }
    const parsed = KeycloakIdClaimsSchema.safeParse(payload)
    if (!parsed.success) return null
    const azp = (payload as { azp?: unknown }).azp
    if (typeof azp === 'string' && azp !== input.clientId) return null
    return parsed.data
  }
}
