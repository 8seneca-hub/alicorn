import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySchema } from './apply-schema.js'
import { openControlPlanePool } from './pool.js'
import { createTestSchema, dropTestSchema } from './postgres-test-schema.js'
import { tenantRlsPolicySql } from './rls-policy-sql.js'
import { withTenant } from './tenant-transaction.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'cp_tenant_tx_test'

describePostgres('withTenant', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: databaseUrl!, schema, applicationName: 'cp-test' })
    await applySchema(pool, [
      `CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`,
      tenantRlsPolicySql('widgets')
    ])
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
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
