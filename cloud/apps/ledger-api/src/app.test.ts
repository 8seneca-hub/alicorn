import { describe, expect, it } from 'vitest'
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
})
