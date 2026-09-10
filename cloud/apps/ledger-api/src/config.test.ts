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
    expect(c.auth.authMode === 'local').toBe(true)
    if (c.auth.authMode === 'local') expect(c.auth.tenantId).toBe('local')
  })
  it('fails without a database url', () => {
    expect(() => loadLedgerApiConfig({ ALICORN_LOCAL_API_TOKEN: base.ALICORN_LOCAL_API_TOKEN })).toThrow()
  })
  it('refuses a short shared token', () => {
    expect(() => loadLedgerApiConfig({ ...base, ALICORN_LOCAL_API_TOKEN: 'short' })).toThrow()
  })
  // docker compose interpolates an unset variable to the empty string, so an empty key id has to
  // read as "not set" — the thumbprint default covers it — rather than keeping the service down.
  it('boots with an empty signing key id, the shape compose actually passes', () => {
    const c = loadLedgerApiConfig({
      ...base,
      ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM: '',
      ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID: ''
    })
    expect(c.exportSigningKey).toBeUndefined()
  })
})
