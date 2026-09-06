import pg from 'pg'
import { assertIdentifier } from './rls-policy-sql.js'

export async function openControlPlanePool(input: {
  databaseUrl: string
  schema: string
  applicationName: string
  poolMax?: number
}): Promise<pg.Pool> {
  const schema = assertIdentifier(input.schema)
  const admin = new pg.Client({ connectionString: input.databaseUrl })
  await admin.connect()
  try {
    const schemaExists = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])
    if (schemaExists.rows.length === 0) {
      await admin.query(`CREATE SCHEMA ${schema}`)
    }
  } finally {
    await admin.end()
  }
  const url = new URL(input.databaseUrl)
  // Why: search_path per connection keeps both services' tables in one database without name clashes.
  url.searchParams.set('options', `-c search_path=${schema}`)
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: input.poolMax ?? 10,
    application_name: input.applicationName,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 10_000
  })
  pool.on('error', () => {}) // idle-client errors surface on the next checkout
  return pool
}
