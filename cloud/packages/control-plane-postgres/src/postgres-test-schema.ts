import pg from 'pg'
import { assertIdentifier } from './rls-policy-sql.js'
async function run(baseUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl })
  await client.connect()
  try { await client.query(sql) } finally { await client.end() }
}
export function createTestSchema(baseUrl: string, schema: string): Promise<void> {
  const s = assertIdentifier(schema)
  return run(baseUrl, `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s}`)
}
export function dropTestSchema(baseUrl: string, schema: string): Promise<void> {
  return run(baseUrl, `DROP SCHEMA IF EXISTS ${assertIdentifier(schema)} CASCADE`)
}
