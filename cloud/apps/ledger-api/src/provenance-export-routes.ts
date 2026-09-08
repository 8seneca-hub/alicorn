import type { Hono } from 'hono'
import {
  buildProvenanceExportDocument,
  canonicalJsonBytes,
  provenanceExportCompactJws,
  provenanceExportJwks,
  provenanceExportObjectKey,
  renderSignedProvenanceMarkdown,
  signProvenanceExport,
  type ProvenanceExportEnvelope
} from '@alicorn-cloud/control-plane-contract'
import type { LedgerApiDeps, LedgerApiEnv } from './app-env.js'
import { getProvenance } from './provenance-repository.js'
import { archiveProvenanceExport } from './provenance-export-archive.js'

const JWKS_PATH = '/.well-known/alicorn-provenance-jwks.json'

/**
 * PV2. `GET /v1/ledger/provenance/export?repoId=&branch=&format=json|md`.
 *
 * Both formats carry the same signed document, so the human-readable artefact and the machine one
 * cannot disagree — the Markdown *is* a field of the signed JSON.
 *
 * With no signing key configured the route refuses with 503 rather than serving an unsigned
 * export. A file that looks like an audit artefact and carries no signature is the failure mode
 * this ticket exists to remove.
 */
// Public by design: these are public keys, and an auditor holding an export must be able to fetch
// them without a tenant token. Registered before requireTenant — Hono applies middleware in
// registration order, so a route added before it is genuinely unauthenticated.
export function registerProvenanceJwksRoute(app: Hono<LedgerApiEnv>, deps: LedgerApiDeps): void {
  app.get(JWKS_PATH, (c) => {
    const key = deps.exportSigningKey
    return c.json(provenanceExportJwks(key ? [key] : []), 200, {
      'cache-control': 'public, max-age=300'
    })
  })
}

export function registerProvenanceExportRoutes(app: Hono<LedgerApiEnv>, deps: LedgerApiDeps): void {
  app.get('/v1/ledger/provenance/export', async (c) => {
    const auth = c.get('auth')
    const repoId = c.req.query('repoId')
    const branch = c.req.query('branch')
    // `markdown` is accepted alongside the plan's `md`: widening an accepted value is additive,
    // narrowing it later would not be.
    const requested = c.req.query('format') ?? 'json'
    if (!repoId || !branch) return c.json({ error: 'invalid_query' }, 400)
    if (requested !== 'json' && requested !== 'md' && requested !== 'markdown') {
      return c.json({ error: 'invalid_query' }, 400)
    }
    const format = requested === 'json' ? 'json' : 'md'

    const key = deps.exportSigningKey
    if (!key) {
      return c.json({ error: 'export_not_configured', jwks: JWKS_PATH }, 503)
    }

    // Tenant-scoped read: getProvenance runs under withTenant, so RLS decides what is in scope and
    // an export can never reach another tenant's steps.
    const report = await getProvenance(deps.pool, auth.tenantId, { repoId, branch })
    const document = buildProvenanceExportDocument({
      tenantId: auth.tenantId,
      report,
      // Server time orders everything; a client clock never dates an audit artefact.
      exportedAt: new Date(deps.now?.() ?? Date.now())
    })
    const signature = signProvenanceExport(document, key)
    const compact = provenanceExportCompactJws(document, signature)

    // Retention keeps the JSON envelope whatever the caller asked for: the Markdown is a rendering
    // of a field inside it, so one retained artefact is enough to reproduce both.
    const archive = await archiveProvenanceExport(deps.exportArchive, {
      key: provenanceExportObjectKey(document, 'json'),
      body: canonicalJsonBytes({ document, signature }),
      contentType: 'application/json',
      tenantId: auth.tenantId
    })

    if (format === 'md') {
      return c.body(renderSignedProvenanceMarkdown(document, compact), 200, {
        'content-type': 'text/markdown; charset=utf-8',
        'x-alicorn-export-key-id': signature.keyId,
        'x-alicorn-export-archived': archive.stored ? archive.uri : `no:${archive.reason}`
      })
    }
    const envelope: ProvenanceExportEnvelope = { document, signature, archive }
    return c.json(envelope)
  })
}
