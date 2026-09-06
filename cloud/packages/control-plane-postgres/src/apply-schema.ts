import type pg from 'pg'
export async function applySchema(pool: pg.Pool, statements: readonly string[]): Promise<void> {
  const client = await pool.connect()
  try {
    for (const statement of statements) {
      await client.query(statement)
    }
  } finally {
    client.release()
  }
}
