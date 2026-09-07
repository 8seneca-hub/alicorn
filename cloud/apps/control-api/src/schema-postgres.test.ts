import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySchema, createTestSchema, dropTestSchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'
const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_schema_test'
describePostgres('control schema', () => {
  let appUrl: string
  // Why: RLS forcing must hold even for the role that owns the schema (R5); a
  // superuser bypasses RLS entirely and would hide a broken policy.
  beforeAll(async () => {
    const result = await createTestSchema(databaseUrl!, schema)
    appUrl = result.appUrl
  })
  afterAll(() => dropTestSchema(databaseUrl!, schema))
  it('applies twice without error and forces RLS on tenant tables', async () => {
    const pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 't' })
    try {
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      const { rows } = await pool.query(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relforcerowsecurity ORDER BY relname`, [schema])
      expect(rows.map((r) => r.relname)).toEqual([
        'member_skills', 'members', 'org_policies', 'project_required_checks', 'rule_proposals', 'stages', 'transitions', 'workflows'
      ])
    } finally {
      await pool.end()
    }
  })
})
