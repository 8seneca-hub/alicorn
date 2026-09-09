import type pg from 'pg'
import type {
  ControlPlaneAuthEnv,
  KeycloakAccessTokenVerifier,
  KeycloakIdTokenVerifier
} from '@alicorn-cloud/control-plane-auth'
import type { ControlApiConfig } from './config.js'
import type { ControlMetrics } from './control-metrics.js'
import type { DesktopIdentityStore } from './desktop-identity-store.js'
import type { KeycloakTokenClient } from './keycloak-token-client.js'

export type { AuthContext } from '@alicorn-cloud/control-plane-auth'
export type ControlApiEnv = ControlPlaneAuthEnv

// Why: moved here from app.ts (R8) — route files importing ControlApiDeps from app.ts
// created a type-only import cycle back through app.ts's route registrations.
export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
  // Why: optional so existing test/prod deps still construct; app.ts defaults it.
  metrics?: ControlMetrics
  // Keycloak mode only (I2). Absent in mode `local`, where there is no token to verify and no
  // sign-in to broker; index.ts builds all four together or none of them.
  verifyAccessToken?: KeycloakAccessTokenVerifier
  verifyIdToken?: KeycloakIdTokenVerifier
  tokenClient?: KeycloakTokenClient
  identityStore?: DesktopIdentityStore
  // I3. Keycloak mode only: maps the verified subject to the internal `users.id` that every
  // product row keys off. Optional so a test can still build the app without a database.
  lookupUserId?: (idpSubject: string) => Promise<string | null>
}
