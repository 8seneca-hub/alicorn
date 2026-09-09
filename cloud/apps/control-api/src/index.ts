import { serve } from '@hono/node-server'
import { createKeycloakVerifiers } from '@alicorn-cloud/control-plane-auth'
import { applySchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { createControlApiApp, type ControlApiDeps } from './app.js'
import { loadControlApiConfig } from './config.js'
import { lookupUserIdBySubject } from './identity-repository.js'
import { createPostgresDesktopIdentityStore } from './postgres-desktop-identity-store.js'
import { createKeycloakTokenClient } from './keycloak-token-client.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const config = loadControlApiConfig()
const pool = await openControlPlanePool({
  databaseUrl: config.databaseUrl, schema: config.databaseSchema,
  applicationName: 'alicorn-control-api', poolMax: config.poolMax
})
await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
// Mode `local` builds none of this: there is no token to verify and no sign-in to broker.
// Bound to a const so the narrowing survives into the lookupUserId closure below.
const auth = config.auth
const keycloak: Partial<ControlApiDeps> =
  auth.authMode === 'keycloak'
    ? {
        ...createKeycloakVerifiers(auth),
        tokenClient: createKeycloakTokenClient({ issuer: auth.internalIssuer, clientId: auth.clientId }),
        // The realm's public URL is the identity namespace — `internalIssuer` is a container
        // address that can change without anyone becoming a different person.
        identityStore: createPostgresDesktopIdentityStore({ pool, idpIssuer: auth.issuer }),
        lookupUserId: (idpSubject) => lookupUserIdBySubject(pool, idpSubject)
      }
    : {}
const app = createControlApiApp({ config, pool, ...keycloak })
serve({ fetch: app.fetch, port: config.port }, () => console.log(`[alicorn-control-api] listening on :${config.port}`))
