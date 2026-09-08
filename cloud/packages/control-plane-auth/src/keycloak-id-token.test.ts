import { describe, expect, it } from 'vitest'
import { createKeycloakIdTokenVerifier } from './keycloak-id-token.js'
import { createTestKeycloak } from './test-keycloak.js'

const ISSUER = 'https://keycloak.example/realms/alicorn'
const CLIENT_ID = 'alicorn-desktop'

async function fixture() {
  const keycloak = await createTestKeycloak({ issuer: ISSUER, clientId: CLIENT_ID })
  return {
    keycloak,
    verify: createKeycloakIdTokenVerifier({ getKey: keycloak.getKey, issuer: ISSUER, clientId: CLIENT_ID })
  }
}

describe('createKeycloakIdTokenVerifier', () => {
  it('returns the nonce and subject of a valid id token', async () => {
    const { keycloak, verify } = await fixture()
    const token = await keycloak.sign({ sub: 'kc-sub-1', azp: CLIENT_ID, nonce: 'n1' }, { audience: CLIENT_ID })
    expect(await verify(token)).toMatchObject({ sub: 'kc-sub-1', nonce: 'n1' })
  })

  it('refuses an id token addressed to another client', async () => {
    const { keycloak, verify } = await fixture()
    const token = await keycloak.sign({ sub: 'kc-sub-1' }, { audience: 'some-other-client' })
    expect(await verify(token)).toBeNull()
  })

  it('refuses an id token from another issuer even when the signature checks out', async () => {
    const { keycloak, verify } = await fixture()
    const token = await keycloak.sign(
      { sub: 'kc-sub-1', nonce: 'n1' },
      { audience: CLIENT_ID, issuer: 'https://someone-elses-keycloak.example/realms/alicorn' }
    )
    expect(await verify(token)).toBeNull()
  })

  it('refuses an expired id token', async () => {
    const { keycloak, verify } = await fixture()
    const token = await keycloak.sign({ sub: 'kc-sub-1' }, { audience: CLIENT_ID, expiresIn: '-1s' })
    expect(await verify(token)).toBeNull()
  })

  it('refuses a token signed by a different key', async () => {
    const { verify } = await fixture()
    const other = await createTestKeycloak({ issuer: ISSUER, clientId: CLIENT_ID })
    const token = await other.sign({ sub: 'kc-sub-1' }, { audience: CLIENT_ID })
    expect(await verify(token)).toBeNull()
  })

  it('refuses garbage', async () => {
    const { verify } = await fixture()
    expect(await verify('not-a-jwt')).toBeNull()
  })
})
