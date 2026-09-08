import { describe, expect, it } from 'vitest'
import { createTestKeycloak } from './test-keycloak.js'
import { createKeycloakAccessTokenVerifier } from './keycloak-token-verifier.js'

const issuer = 'https://id.example.com/realms/alicorn'
const clientId = 'alicorn-desktop'

async function harness() {
  const kc = await createTestKeycloak({ issuer, clientId })
  return { kc, verify: createKeycloakAccessTokenVerifier({ getKey: kc.getKey, issuer, clientId }) }
}

describe('createKeycloakAccessTokenVerifier', () => {
  it('accepts a well-formed token and returns its claims', async () => {
    const { kc, verify } = await harness()
    const token = await kc.sign({ sub: 'kc-1', azp: clientId, typ: 'Bearer', organization: { acme: { id: 'org-1' } } })
    const claims = await verify(token)
    expect(claims?.sub).toBe('kc-1')
    expect(claims?.organization).toEqual({ acme: { id: 'org-1' } })
  })
  it('rejects a token issued to another client (azp)', async () => {
    const { kc, verify } = await harness()
    expect(await verify(await kc.sign({ sub: 'kc-1', azp: 'some-other-client' }))).toBeNull()
  })
  it('rejects a token from another issuer', async () => {
    const { kc, verify } = await harness()
    expect(await verify(await kc.sign({ sub: 'kc-1', azp: clientId }, { issuer: 'https://evil.example.com/realms/alicorn' }))).toBeNull()
  })
  it('rejects an expired token', async () => {
    const { kc, verify } = await harness()
    expect(await verify(await kc.sign({ sub: 'kc-1', azp: clientId }, { expiresIn: '-1s' }))).toBeNull()
  })
  it('rejects an id token presented as an access token', async () => {
    const { kc, verify } = await harness()
    expect(await verify(await kc.sign({ sub: 'kc-1', azp: clientId, typ: 'ID' }))).toBeNull()
  })
  it('rejects a token signed by a different key', async () => {
    const { verify } = await harness()
    const other = await createTestKeycloak({ issuer, clientId })
    expect(await verify(await other.sign({ sub: 'kc-1', azp: clientId }))).toBeNull()
  })
  it('rejects an unsigned token', async () => {
    const { verify } = await harness()
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'test-key-1' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: 'kc-1', azp: clientId, iss: issuer, exp: 4102444800 })).toString('base64url')
    expect(await verify(`${header}.${payload}.`)).toBeNull()
  })
  it('rejects garbage', async () => {
    const { verify } = await harness()
    expect(await verify('not-a-token')).toBeNull()
  })
})
