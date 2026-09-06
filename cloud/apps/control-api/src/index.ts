import { serve } from '@hono/node-server'
import { applySchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const config = loadControlApiConfig()
const pool = await openControlPlanePool({
  databaseUrl: config.databaseUrl, schema: config.databaseSchema,
  applicationName: 'alicorn-control-api', poolMax: config.poolMax
})
await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
const app = createControlApiApp({ config, pool })
serve({ fetch: app.fetch, port: config.port }, () => console.log(`[alicorn-control-api] listening on :${config.port}`))
