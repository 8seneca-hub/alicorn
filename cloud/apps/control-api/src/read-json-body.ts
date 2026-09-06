import type { Context } from 'hono'
export type JsonBody = { ok: true; value: unknown } | { ok: false }
// Why: hono rethrows JSON.parse errors; unguarded, a malformed body becomes a text/plain 500.
export async function readJsonBody(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() }
  } catch {
    return { ok: false }
  }
}
