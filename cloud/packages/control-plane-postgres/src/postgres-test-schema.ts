import pg from 'pg'
import { assertIdentifier } from './rls-policy-sql.js'

export async function createTestSchema(
  baseUrl: string,
  schema: string
): Promise<{ appUrl: string }> {
  const s = assertIdentifier(schema)
  const role = assertIdentifier(`cp_test_${schema}`)

  const client = new pg.Client({ connectionString: baseUrl })
  await client.connect()
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`)
    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if (roleExists.rows.length > 0) {
      await client.query(`DROP OWNED BY ${role}`)
      await client.query(`DROP ROLE ${role}`)
    }
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD 'cp-test'`)
    await client.query(`CREATE SCHEMA ${s} AUTHORIZATION ${role}`)
  } finally {
    await client.end()
  }

  const url = new URL(baseUrl)
  url.username = role
  url.password = 'cp-test'
  return { appUrl: url.toString() }
}

export async function dropTestSchema(baseUrl: string, schema: string): Promise<void> {
  const s = assertIdentifier(schema)
  const role = assertIdentifier(`cp_test_${schema}`)

  const client = new pg.Client({ connectionString: baseUrl })
  await client.connect()
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`)
    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if (roleExists.rows.length > 0) {
      await client.query(`DROP OWNED BY ${role}`)
      await client.query(`DROP ROLE ${role}`)
    }
  } finally {
    await client.end()
  }
}
