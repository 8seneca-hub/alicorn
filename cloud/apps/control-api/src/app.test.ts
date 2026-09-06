import { describe, expect, it } from 'vitest'
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
})
