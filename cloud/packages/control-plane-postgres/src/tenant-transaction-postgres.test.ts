import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySchema } from './apply-schema.js'
import { openControlPlanePool } from './pool.js'
import { createTestSchema, dropTestSchema } from './postgres-test-schema.js'
import { tenantRlsPolicySql } from './rls-policy-sql.js'
import { inTransaction, setTenantScope, withTenant } from './tenant-transaction.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'cp_tenant_tx_test'

describePostgres('withTenant', () => {
  let pool: pg.Pool
  let appUrl: string
  beforeAll(async () => {
    const result = await createTestSchema(databaseUrl!, schema)
    appUrl = result.appUrl
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'cp-test' })
    await applySchema(pool, [
      `CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`,
      tenantRlsPolicySql('widgets')
    ])
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('runs as a non-superuser role', async () => {
    const result = await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')
    expect(result.rows[0].rolsuper).toBe(false)
  })

  it('isolates rows by tenant even for the owning role', async () => {
    await withTenant(pool, 'tenant-a', (c) => c.query(`INSERT INTO widgets VALUES ('w1', 'tenant-a', 'A')`))
    await withTenant(pool, 'tenant-b', (c) => c.query(`INSERT INTO widgets VALUES ('w2', 'tenant-b', 'B')`))
    const a = await withTenant(pool, 'tenant-a', (c) => c.query(`SELECT id FROM widgets ORDER BY id`))
    expect(a.rows.map((r) => r.id)).toEqual(['w1'])
    const none = await pool.query(`SELECT id FROM widgets`)
    expect(none.rows).toEqual([]) // no tenant set → policy false → nothing visible
  })

  it('refuses to insert a row for another tenant', async () => {
    await expect(
      withTenant(pool, 'tenant-a', (c) => c.query(`INSERT INTO widgets VALUES ('w3', 'tenant-b', 'X')`))
    ).rejects.toMatchObject({ code: '42501' })
  })
})

// The primitives underneath `withTenant`, exported for the one write that legitimately spans
// tenants: syncing one person's organisation memberships (I3) has to be atomic across all of them.
describePostgres('inTransaction and setTenantScope', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const result = await createTestSchema(databaseUrl!, 'cp_scope_tx_test')
    pool = await openControlPlanePool({
      databaseUrl: result.appUrl,
      schema: 'cp_scope_tx_test',
      applicationName: 'cp-test'
    })
    await applySchema(pool, [
      `CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`,
      tenantRlsPolicySql('widgets')
    ])
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, 'cp_scope_tx_test')
  })

  it('sets no tenant of its own, so an RLS table stays invisible until one is chosen', async () => {
    const result = await inTransaction(pool, (c) =>
      c.query<{ tenant: string | null }>(`SELECT current_setting('app.tenant_id', true) AS tenant`)
    )
    expect(result.rows[0]!.tenant).toBeNull()
  })

  it('re-scopes within one transaction so a multi-tenant write is still all-or-nothing', async () => {
    await inTransaction(pool, async (c) => {
      await setTenantScope(c, 'tenant-a')
      await c.query(`INSERT INTO widgets VALUES ('s1', 'tenant-a', 'A')`)
      await setTenantScope(c, 'tenant-b')
      await c.query(`INSERT INTO widgets VALUES ('s2', 'tenant-b', 'B')`)
    })
    const a = await withTenant(pool, 'tenant-a', (c) => c.query(`SELECT id FROM widgets`))
    expect(a.rows.map((r) => r.id)).toEqual(['s1'])

    await expect(
      inTransaction(pool, async (c) => {
        await setTenantScope(c, 'tenant-a')
        await c.query(`INSERT INTO widgets VALUES ('s3', 'tenant-a', 'A')`)
        await setTenantScope(c, 'tenant-b')
        // Rejected by the policy — and it must take the tenant-a row with it.
        await c.query(`INSERT INTO widgets VALUES ('s4', 'tenant-a', 'X')`)
      })
    ).rejects.toMatchObject({ code: '42501' })
    const after = await withTenant(pool, 'tenant-a', (c) => c.query(`SELECT id FROM widgets ORDER BY id`))
    expect(after.rows.map((r) => r.id)).toEqual(['s1'])
  })
})
