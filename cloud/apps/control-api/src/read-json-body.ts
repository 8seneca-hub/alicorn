import type { Context } from 'hono'
import type { z } from 'zod'
export type JsonBody = { ok: true; value: unknown } | { ok: false }
// Why: hono rethrows JSON.parse errors; unguarded, a malformed body becomes a text/plain 500.
export async function readJsonBody(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() }
  } catch {
    return { ok: false }
  }
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response }

/** Read + validate in one step, so every route answers a bad body with the same 400 shape. */
export async function parseJsonBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<ParsedBody<z.infer<T>>> {
  const body = await readJsonBody(c)
  if (!body.ok) return { ok: false, response: c.json({ error: 'invalid_body', issues: [] }, 400) }
  const result = schema.safeParse(body.value)
  if (!result.success) {
    return { ok: false, response: c.json({ error: 'invalid_body', issues: result.error.issues }, 400) }
  }
  return { ok: true, data: result.data }
}
