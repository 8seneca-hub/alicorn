import { serve } from '@hono/node-server'
import { applySchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import { LEDGER_SCHEMA_STATEMENTS } from './schema-sql.js'

const config = loadLedgerApiConfig()
const pool = await openControlPlanePool({
  databaseUrl: config.databaseUrl, schema: config.databaseSchema,
  applicationName: 'alicorn-ledger-api', poolMax: config.poolMax
})
await applySchema(pool, LEDGER_SCHEMA_STATEMENTS)
const app = createLedgerApiApp({ config, pool })
serve({ fetch: app.fetch, port: config.port }, () => console.log(`[alicorn-ledger-api] listening on :${config.port}`))
