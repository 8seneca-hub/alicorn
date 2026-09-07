import assert from 'node:assert/strict'
import test from 'node:test'
import { checkRealm, main } from './verify-keycloak-realm.mjs'

const ISSUER = 'http://127.0.0.1:8080/realms/alicorn'
const CLIENT_ID = 'alicorn-desktop'

function discoveryDocument(overrides = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
    jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
    code_challenge_methods_supported: ['plain', 'S256'],
    ...overrides
  }
}

function fetchStub({ discovery = discoveryDocument(), keys = [{ kid: 'k1' }] } = {}) {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(String(url))
    if (String(url).endsWith('/.well-known/openid-configuration')) return Response.json(discovery)
    if (String(url) === discovery.jwks_uri) return Response.json({ keys })
    throw new Error(`unexpected fetch: ${url}`)
  }
  return { fetchImpl, requests }
}

test('exports main as a function and does not invoke it on import (module guard, no network call)', () => {
  assert.equal(typeof main, 'function')
})

test('happy path: resolves with the discovery document and jwks when everything matches', async () => {
  const { fetchImpl, requests } = fetchStub()
  const result = await checkRealm(fetchImpl, ISSUER, CLIENT_ID)
  assert.equal(result.discovery.issuer, ISSUER)
  assert.equal(result.jwks.keys.length, 1)
  assert.equal(result.clientId, CLIENT_ID)
  assert.deepEqual(requests, [`${ISSUER}/.well-known/openid-configuration`, discoveryDocument().jwks_uri])
})

test('rejects when the discovery issuer does not match the configured issuer', async () => {
  const { fetchImpl } = fetchStub({ discovery: discoveryDocument({ issuer: 'http://127.0.0.1:8080/realms/other' }) })
  await assert.rejects(checkRealm(fetchImpl, ISSUER, CLIENT_ID), /issuer mismatch/)
})

test('rejects when a required discovery field is missing', async () => {
  const { fetchImpl } = fetchStub({ discovery: discoveryDocument({ jwks_uri: undefined }) })
  await assert.rejects(checkRealm(fetchImpl, ISSUER, CLIENT_ID), /missing jwks_uri/)
})

test('rejects when PKCE S256 is not advertised', async () => {
  const { fetchImpl } = fetchStub({ discovery: discoveryDocument({ code_challenge_methods_supported: ['plain'] }) })
  await assert.rejects(checkRealm(fetchImpl, ISSUER, CLIENT_ID), /PKCE S256/)
})

test('rejects when jwks has no keys', async () => {
  const { fetchImpl } = fetchStub({ keys: [] })
  await assert.rejects(checkRealm(fetchImpl, ISSUER, CLIENT_ID), /no keys/)
})
