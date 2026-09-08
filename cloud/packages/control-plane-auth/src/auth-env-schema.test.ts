import { describe, expect, it } from 'vitest'
import { parseAuthConfig } from './auth-env-schema.js'

describe('parseAuthConfig', () => {
  it('applies defaults in local mode', () => {
    const c = parseAuthConfig({ ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789' })
    expect(c).toEqual({ authMode: 'local', tenantId: 'local', localApiToken: 'local-dev-token-0123456789' })
  })
  it('throws in local mode without a token', () => {
    expect(() => parseAuthConfig({})).toThrow('ALICORN_LOCAL_API_TOKEN required in local mode')
  })
  it('throws in keycloak mode without an issuer', () => {
    expect(() => parseAuthConfig({ ALICORN_AUTH_MODE: 'keycloak' })).toThrow('ALICORN_KEYCLOAK_ISSUER required in keycloak mode')
  })
  it('strips a trailing slash from the issuer and internal issuer', () => {
    const c = parseAuthConfig({
      ALICORN_AUTH_MODE: 'keycloak',
      ALICORN_KEYCLOAK_ISSUER: 'https://id.example.com/realms/alicorn/',
      ALICORN_KEYCLOAK_INTERNAL_ISSUER: 'https://keycloak.internal/realms/alicorn/'
    })
    expect(c).toEqual({
      authMode: 'keycloak',
      issuer: 'https://id.example.com/realms/alicorn',
      internalIssuer: 'https://keycloak.internal/realms/alicorn',
      clientId: 'alicorn-desktop',
      allowInsecureJwks: false
    })
  })
  it('defaults the internal issuer to the issuer', () => {
    const c = parseAuthConfig({ ALICORN_AUTH_MODE: 'keycloak', ALICORN_KEYCLOAK_ISSUER: 'https://id.example.com/realms/alicorn' })
    expect(c).toEqual({
      authMode: 'keycloak',
      issuer: 'https://id.example.com/realms/alicorn',
      internalIssuer: 'https://id.example.com/realms/alicorn',
      clientId: 'alicorn-desktop',
      allowInsecureJwks: false
    })
  })
})
