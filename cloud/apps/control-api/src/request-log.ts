import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

type EnvWithAuth = { Variables: { auth?: { tenantId: string } } }

// Why: one JSON line per request for Loki (tenant_id, request_id); duplicated per-app on purpose (tier-1 decision 7).
export function requestLog<Env extends EnvWithAuth>(
  service: string,
  write: (line: string) => void = (line) => console.log(line)
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const start = Date.now()
    const requestId = c.req.header('x-request-id') ?? randomUUID()
    await next()
    c.header('x-request-id', requestId)
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        service,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Date.now() - start,
        tenant_id: c.get('auth')?.tenantId ?? null,
        request_id: requestId
      })
    )
  }
}
