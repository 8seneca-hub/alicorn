import { describe, expect, it } from 'vitest'
import { JWKS_CACHE_MAX_AGE_MS, JWKS_COOLDOWN_MS, assertJwksTransportAllowed, keycloakJwksUri } from './keycloak-jwks.js'

describe('keycloak jwks transport', () => {
  it('derives the certs endpoint from the issuer', () => {
    expect(keycloakJwksUri('https://id.example.com/realms/alicorn')).toBe(
      'https://id.example.com/realms/alicorn/protocol/openid-connect/certs'
    )
  })
  it('allows https anywhere', () => {
    expect(() => assertJwksTransportAllowed('https://id.example.com/x', false)).not.toThrow()
  })
  it('allows plaintext on loopback', () => {
    expect(() => assertJwksTransportAllowed('http://127.0.0.1:8080/x', false)).not.toThrow()
    expect(() => assertJwksTransportAllowed('http://localhost:8080/x', false)).not.toThrow()
  })
  it('refuses plaintext to a remote host unless explicitly allowed', () => {
    expect(() => assertJwksTransportAllowed('http://keycloak.internal/x', false)).toThrow('refusing to fetch JWKS')
    expect(() => assertJwksTransportAllowed('http://keycloak.internal/x', true)).not.toThrow()
  })
  it('bounds the cache so key rotation cannot become a fetch per request', () => {
    expect(JWKS_COOLDOWN_MS).toBeGreaterThanOrEqual(30_000)
    expect(JWKS_CACHE_MAX_AGE_MS).toBeGreaterThanOrEqual(60_000)
  })
})
