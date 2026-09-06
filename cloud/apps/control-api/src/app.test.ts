import { describe, expect, it, vi } from 'vitest'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
export function testDeps(overrides: Partial<Parameters<typeof createControlApiApp>[0]> = {}) {
  return {
    config: loadControlApiConfig({ ALICORN_DATABASE_URL: 'postgres://x', ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789' }),
    pool: {} as never,
    ...overrides
  }
}
describe('control-api app', () => {
  it('answers healthz', async () => {
    const res = await createControlApiApp(testDeps()).request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, service: 'control-api' })
  })

  it('returns 500 { error: internal } for an unhandled route error', async () => {
    const app = createControlApiApp(testDeps())
    app.get('/boom', () => {
      throw new Error('x')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })

  it('still logs one JSON line for an unhandled route error, with status 500 and a request_id', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    const app = createControlApiApp(testDeps())
    app.get('/boom', () => {
      throw new Error('x')
    })
    const res = await app.request('/boom')
    spy.mockRestore()

    expect(res.status).toBe(500)
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)
    expect(entry).toMatchObject({ service: 'control-api', method: 'GET', path: '/boom', status: 500 })
    expect(typeof entry.request_id).toBe('string')
    expect(res.headers.get('x-request-id')).toBe(entry.request_id)
  })

  it('logs one JSON line per request, with tenant_id for an authenticated call and echoed x-request-id', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    const app = createControlApiApp(testDeps())
    app.get('/v1/test-authed', (c) => c.json({ ok: true }))

    const authed = await app.request('/v1/test-authed', {
      headers: { authorization: 'Bearer local-dev-token-0123456789' }
    })
    const health = await app.request('/healthz')
    spy.mockRestore()

    expect(authed.status).toBe(200)
    expect(health.status).toBe(200)
    expect(lines).toHaveLength(2)

    const authedEntry = JSON.parse(lines[0]!)
    expect(authedEntry).toMatchObject({
      service: 'control-api', method: 'GET', path: '/v1/test-authed', status: 200, tenant_id: 'local'
    })
    expect(typeof authedEntry.duration_ms).toBe('number')
    expect(authed.headers.get('x-request-id')).toBe(authedEntry.request_id)

    const healthEntry = JSON.parse(lines[1]!)
    expect(healthEntry).toMatchObject({
      service: 'control-api', method: 'GET', path: '/healthz', status: 200, tenant_id: null
    })
  })

  it('exposes prometheus request counters on GET /metrics', async () => {
    const app = createControlApiApp(testDeps())
    await app.request('/healthz')
    const res = await app.request('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    const text = await res.text()
    expect(text).toContain('# TYPE http_requests_total counter')
    expect(text).toContain('http_requests_total{method="GET",status="200"} 1')
  })
})
