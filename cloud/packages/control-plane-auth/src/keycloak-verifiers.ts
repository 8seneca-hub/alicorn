import type { AuthConfig } from './auth-env-schema.js'
import { createKeycloakIdTokenVerifier, type KeycloakIdTokenVerifier } from './keycloak-id-token.js'
import { createKeycloakJwks } from './keycloak-jwks.js'
import {
  createKeycloakAccessTokenVerifier,
  type KeycloakAccessTokenVerifier
} from './keycloak-token-verifier.js'

export type KeycloakAuthConfig = Extract<AuthConfig, { authMode: 'keycloak' }>

export type KeycloakVerifiers = {
  verifyAccessToken: KeycloakAccessTokenVerifier
  verifyIdToken: KeycloakIdTokenVerifier
}

// Why two issuers: keys are fetched over the container network (`internalIssuer`) but `iss` in a
// token is whatever the browser saw (`issuer`). Comparing against the reachable URL instead would
// make every token from the real realm fail — and, worse, make it tempting to stop comparing.
export function createKeycloakVerifiers(config: KeycloakAuthConfig): KeycloakVerifiers {
  const getKey = createKeycloakJwks({
    issuer: config.internalIssuer,
    allowInsecureHttp: config.allowInsecureJwks
  })
  const shared = { getKey, issuer: config.issuer, clientId: config.clientId }
  return {
    verifyAccessToken: createKeycloakAccessTokenVerifier(shared),
    verifyIdToken: createKeycloakIdTokenVerifier(shared)
  }
}
