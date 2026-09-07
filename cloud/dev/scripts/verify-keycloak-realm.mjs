import { pathToFileURL } from 'node:url'

// Why: the desktop OAuth flow depends on all four of these existing at the exact issuer it's configured with.
export async function checkRealm(fetchImpl, issuer, clientId) {
  const discoveryResponse = await fetchImpl(`${issuer}/.well-known/openid-configuration`)
  if (!discoveryResponse.ok) throw new Error(`discovery request failed: ${discoveryResponse.status}`)
  const discovery = await discoveryResponse.json()

  if (discovery.issuer !== issuer) {
    throw new Error(`issuer mismatch: expected ${issuer}, got ${discovery.issuer}`)
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'end_session_endpoint']) {
    if (!discovery[field]) throw new Error(`discovery document missing ${field}`)
  }
  if (!discovery.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('discovery document does not advertise PKCE S256')
  }

  const jwksResponse = await fetchImpl(discovery.jwks_uri)
  if (!jwksResponse.ok) throw new Error(`jwks request failed: ${jwksResponse.status}`)
  const jwks = await jwksResponse.json()
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1) {
    throw new Error('jwks has no keys')
  }

  return { discovery, jwks, clientId }
}

export async function main() {
  const issuer = process.env.ALICORN_KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/alicorn'
  const clientId = process.env.ALICORN_DESKTOP_CLIENT_ID ?? 'alicorn-desktop'
  await checkRealm(fetch, issuer, clientId)
  console.log(`Keycloak realm OK: ${issuer} (client ${clientId})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
