import { describe, expect, it } from 'vitest'
import { loadControlApiConfig } from './config.js'
const base = {
  ALICORN_DATABASE_URL: 'postgres://u:p@db:5432/alicorn',
  ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789'
}
describe('loadControlApiConfig', () => {
  it('applies defaults', () => {
    const c = loadControlApiConfig(base)
    expect(c.port).toBe(8081)
    expect(c.databaseSchema).toBe('control')
    expect(c.authMode).toBe('local')
    expect(c.tenantId).toBe('local')
  })
  it('fails without a database url', () => {
    expect(() => loadControlApiConfig({ ALICORN_LOCAL_API_TOKEN: base.ALICORN_LOCAL_API_TOKEN })).toThrow()
  })
  it('refuses a short shared token', () => {
    expect(() => loadControlApiConfig({ ...base, ALICORN_LOCAL_API_TOKEN: 'short' })).toThrow()
  })
})
