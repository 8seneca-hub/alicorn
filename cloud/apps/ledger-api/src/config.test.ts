import { describe, expect, it } from 'vitest'
import { loadLedgerApiConfig } from './config.js'
const base = {
  ALICORN_DATABASE_URL: 'postgres://u:p@db:5432/alicorn',
  ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789'
}
describe('loadLedgerApiConfig', () => {
  it('applies defaults', () => {
    const c = loadLedgerApiConfig(base)
    expect(c.port).toBe(8082)
    expect(c.databaseSchema).toBe('ledger')
    expect(c.authMode).toBe('local')
    expect(c.tenantId).toBe('local')
  })
  it('fails without a database url', () => {
    expect(() => loadLedgerApiConfig({ ALICORN_LOCAL_API_TOKEN: base.ALICORN_LOCAL_API_TOKEN })).toThrow()
  })
  it('refuses a short shared token', () => {
    expect(() => loadLedgerApiConfig({ ...base, ALICORN_LOCAL_API_TOKEN: 'short' })).toThrow()
  })
})
