import type pg from 'pg'

export async function inTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
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
// Exported on its own because a write that spans several tenants atomically — syncing one user's
// organisation memberships (I3) — has to re-scope between statements, which `withTenant` cannot do.
export async function setTenantScope(client: pg.PoolClient, tenantId: string): Promise<void> {
  if (!tenantId) throw new Error('tenant_required')
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
}

export function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error('tenant_required')
  return inTransaction(pool, async (c) => {
    await setTenantScope(c, tenantId)
    return fn(c)
  })
}
