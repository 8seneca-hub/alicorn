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
  // Why the identity tables are not all in the list below: `users`, `tenants` and
  // `cloud_profiles` are not tenant-scoped — a user is one human across organisations, and the
  // tenant directory is what `tenant_id` points at. `org_roles`, the membership, is, and is here.
  it('applies twice without error and forces RLS on tenant tables', async () => {
    const pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 't' })
    try {
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      const { rows } = await pool.query(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relforcerowsecurity ORDER BY relname`, [schema])
      expect(rows.map((r) => r.relname)).toEqual([
        'autonomy_policies', 'contract_acknowledgements', 'member_skills', 'members',
        'org_invites', 'org_policies', 'org_roles',
        'project_protected_paths', 'project_required_checks', 'project_stage_config',
        'rule_proposals', 'seats', 'stages', 'transitions', 'workflows'
      ])
    } finally {
      await pool.end()
    }
  })
})
