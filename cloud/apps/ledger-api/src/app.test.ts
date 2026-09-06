import { describe, expect, it, vi } from 'vitest'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
export function testDeps(overrides: Partial<Parameters<typeof createLedgerApiApp>[0]> = {}) {
  return {
    config: loadLedgerApiConfig({ ALICORN_DATABASE_URL: 'postgres://x', ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789' }),
    pool: {} as never,
    ...overrides
  }
}
describe('ledger-api app', () => {
  it('answers healthz', async () => {
    const res = await createLedgerApiApp(testDeps()).request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, service: 'ledger-api' })
  })

  it('returns 500 { error: internal } for an unhandled route error', async () => {
    const app = createLedgerApiApp(testDeps())
    app.get('/boom', () => {
      throw new Error('x')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })

  it('logs one JSON line per request, with tenant_id for an authenticated call and echoed x-request-id', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    const app = createLedgerApiApp(testDeps())
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
      service: 'ledger-api', method: 'GET', path: '/v1/test-authed', status: 200, tenant_id: 'local'
    })
    expect(typeof authedEntry.duration_ms).toBe('number')
    expect(authed.headers.get('x-request-id')).toBe(authedEntry.request_id)

    const healthEntry = JSON.parse(lines[1]!)
    expect(healthEntry).toMatchObject({
      service: 'ledger-api', method: 'GET', path: '/healthz', status: 200, tenant_id: null
    })
  })

  it('exposes prometheus metrics, refreshing the amended-within-window gauge from the pool', async () => {
    const fakeClient = { query: async () => ({ rows: [{ count: '0' }] }), release: () => {} }
    const fakePool = { connect: async () => fakeClient }
    const app = createLedgerApiApp(testDeps({ pool: fakePool as never }))
    const res = await app.request('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    const text = await res.text()
    expect(text).toContain('# TYPE ledger_write_duplicates_total counter')
    expect(text).toContain('ledger_write_duplicates_total 0')
    expect(text).toContain('# TYPE gate_decisions_total counter')
    expect(text).toContain('# TYPE amended_within_window gauge')
    expect(text).toContain('amended_within_window 0')
  })
})
