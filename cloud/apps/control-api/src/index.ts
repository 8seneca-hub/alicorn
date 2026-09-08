import { serve } from '@hono/node-server'
import { createKeycloakVerifiers } from '@alicorn-cloud/control-plane-auth'
import { applySchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { createControlApiApp, type ControlApiDeps } from './app.js'
import { loadControlApiConfig } from './config.js'
import { createInProcessDesktopIdentityStore } from './desktop-identity-store.js'
import { createKeycloakTokenClient } from './keycloak-token-client.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const config = loadControlApiConfig()
const pool = await openControlPlanePool({
  databaseUrl: config.databaseUrl, schema: config.databaseSchema,
  applicationName: 'alicorn-control-api', poolMax: config.poolMax
})
await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
// Mode `local` builds none of this: there is no token to verify and no sign-in to broker.
const keycloak: Partial<ControlApiDeps> =
  config.auth.authMode === 'keycloak'
    ? {
        ...createKeycloakVerifiers(config.auth),
        tokenClient: createKeycloakTokenClient({
          issuer: config.auth.internalIssuer,
          clientId: config.auth.clientId
        }),
        identityStore: createInProcessDesktopIdentityStore()
      }
    : {}
const app = createControlApiApp({ config, pool, ...keycloak })
serve({ fetch: app.fetch, port: config.port }, () => console.log(`[alicorn-control-api] listening on :${config.port}`))
