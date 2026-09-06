import type pg from 'pg'
async function transaction<T>(pool: pg.Pool, prepare: (c: pg.PoolClient) => Promise<void>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await prepare(client)
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
// Why: set_config(..., true) is transaction-local, so a pooled connection never leaks a tenant.
export function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error('tenant_required')
  return transaction(pool, async (c) => { await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]) }, fn)
}
