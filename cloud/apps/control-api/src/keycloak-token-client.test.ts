import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestKeycloakServer, type TestKeycloakServer } from '@alicorn-cloud/control-plane-auth'
import { KeycloakTokenError, createKeycloakTokenClient } from './keycloak-token-client.js'

const CLIENT_ID = 'alicorn-desktop'

describe('keycloak token client', () => {
  let server: TestKeycloakServer
  let client: ReturnType<typeof createKeycloakTokenClient>

  beforeAll(async () => {
    server = await startTestKeycloakServer({ clientId: CLIENT_ID })
    client = createKeycloakTokenClient({ issuer: server.issuer, clientId: CLIENT_ID })
  })
  afterAll(async () => {
    await server.close()
  })

  it('exchanges a code with the five PKCE form parameters', async () => {
    server.setTokenResponse({ expiresIn: 300 })
    const tokens = await client.exchangeCode({
      code: 'the-code',
      codeVerifier: 'the-verifier',
      redirectUri: 'http://127.0.0.1:54321/auth/callback'
    })
    expect(tokens.accessToken.length).toBeGreaterThan(0)
    expect(tokens.refreshToken).toBe('test-refresh-token')
    expect(tokens.idToken?.length).toBeGreaterThan(0)
    expect(tokens.expiresIn).toBe(300)

    const request = server.requests.at(-1)
    expect(request?.path).toBe(new URL(`${server.issuer}/protocol/openid-connect/token`).pathname)
    expect(request?.body).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'the-code',
      redirect_uri: 'http://127.0.0.1:54321/auth/callback',
      code_verifier: 'the-verifier'
    })
  })

  it('refreshes with grant_type refresh_token', async () => {
    server.setTokenResponse({})
    await client.refresh({ refreshToken: 'stored-refresh' })
    expect(server.requests.at(-1)?.body).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'stored-refresh'
    })
  })

  it('maps a rejected grant to KeycloakTokenError carrying the OAuth code', async () => {
    server.setTokenResponse({ error: { status: 400, code: 'invalid_grant' } })
    const error = await client
      .exchangeCode({ code: 'x', codeVerifier: 'y', redirectUri: 'http://127.0.0.1/cb' })
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(KeycloakTokenError)
    expect(error).toMatchObject({ status: 400, errorCode: 'invalid_grant' })
  })

  it('reports a malformed 200 rather than returning empty tokens', async () => {
    const client2 = createKeycloakTokenClient({
      issuer: server.issuer,
      clientId: CLIENT_ID,
      fetch: async () => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 })
    })
    await expect(client2.refresh({ refreshToken: 'r' })).rejects.toMatchObject({
      errorCode: 'malformed_token_response'
    })
  })

  it('posts the refresh token to the logout endpoint', async () => {
    server.setTokenResponse({})
    await client.logout({ refreshToken: 'stored-refresh' })
    const request = server.requests.at(-1)
    expect(request?.path).toBe(new URL(`${server.issuer}/protocol/openid-connect/logout`).pathname)
    expect(request?.body).toEqual({ client_id: CLIENT_ID, refresh_token: 'stored-refresh' })
  })

  it('never follows a redirect away from the token endpoint', async () => {
    let requested: RequestInit | undefined
    const client2 = createKeycloakTokenClient({
      issuer: server.issuer,
      clientId: CLIENT_ID,
      fetch: async (_url, init) => {
        requested = init
        return new Response('{}', { status: 500 })
      }
    })
    await client2.refresh({ refreshToken: 'r' }).catch(() => undefined)
    expect(requested?.redirect).toBe('error')
  })
})
