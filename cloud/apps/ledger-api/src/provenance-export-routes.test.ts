import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readProvenanceExportSigningKey } from '@alicorn-cloud/control-plane-contract'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import { archiveProvenanceExport } from './provenance-export-archive.js'

function testKey() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return readProvenanceExportSigningKey(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
}

function deps(overrides: Partial<Parameters<typeof createLedgerApiApp>[0]> = {}) {
  return {
    config: loadLedgerApiConfig({
      ALICORN_DATABASE_URL: 'postgres://x',
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789'
    }),
    pool: {} as never,
    ...overrides
  }
}

const authHeaders = { authorization: 'Bearer local-dev-token-0123456789' }

describe('provenance export routes', () => {
  it('publishes the public key unauthenticated, and never the private half', async () => {
    const key = testKey()
    const res = await createLedgerApiApp(deps({ exportSigningKey: key })).request(
      '/.well-known/alicorn-provenance-jwks.json'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { keys: Record<string, unknown>[] }
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: key.keyId })
    expect(JSON.stringify(body)).not.toContain('"d"')
  })

  it('publishes an empty key set rather than 404 when no key is configured', async () => {
    const res = await createLedgerApiApp(deps()).request('/.well-known/alicorn-provenance-jwks.json')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ keys: [] })
  })

  it('refuses to export at all without a signing key', async () => {
    const res = await createLedgerApiApp(deps()).request(
      '/v1/ledger/provenance/export?repoId=r1&branch=main',
      { headers: authHeaders }
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'export_not_configured' })
  })

  it('needs a tenant token even though the key set is public', async () => {
    const res = await createLedgerApiApp(deps({ exportSigningKey: testKey() })).request(
      '/v1/ledger/provenance/export?repoId=r1&branch=main'
    )
    expect(res.status).toBe(401)
  })

  it('rejects a missing subject and an unknown format before touching the database', async () => {
    const app = createLedgerApiApp(deps({ exportSigningKey: testKey() }))
    for (const query of ['?branch=main', '?repoId=r1', '?repoId=r1&branch=main&format=pdf']) {
      const res = await app.request(`/v1/ledger/provenance/export${query}`, { headers: authHeaders })
      expect(res.status).toBe(400)
    }
  })
})

describe('archiveProvenanceExport', () => {
  const input = { key: 'k', body: new Uint8Array([1]), contentType: 'application/json', tenantId: 'local' }

  it('reports that nothing was stored when no adapter is wired', async () => {
    await expect(archiveProvenanceExport(undefined, input)).resolves.toEqual({
      stored: false,
      reason: 'not_configured'
    })
  })

  it('reports the uri an adapter returns', async () => {
    const archive = { put: async () => ({ uri: 'gs://bucket/k' }) }
    await expect(archiveProvenanceExport(archive, input)).resolves.toEqual({
      stored: true,
      uri: 'gs://bucket/k'
    })
  })

  it('reports a failed store instead of losing the export', async () => {
    const archive = {
      put: () => Promise.reject(new Error('bucket unreachable'))
    }
    await expect(archiveProvenanceExport(archive, input)).resolves.toEqual({
      stored: false,
      reason: 'failed'
    })
  })
})
