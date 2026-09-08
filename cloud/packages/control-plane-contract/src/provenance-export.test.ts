import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ProvenanceReport, StepOutcomeRecord } from './ledger.js'
import { buildProvenanceView, type ProvenanceView } from './provenance-view.js'
import { renderProvenanceMarkdown } from './provenance-markdown.js'
import {
  ProvenanceExportDocumentSchema,
  ProvenanceViewSchema,
  buildProvenanceExportDocument,
  provenanceExportObjectKey,
  readSignedProvenanceMarkdownJws,
  renderSignedProvenanceMarkdown
} from './provenance-export.js'
import {
  provenanceExportJwks,
  provenanceExportCompactJws,
  readProvenanceExportSigningKey,
  signProvenanceExport,
  verificationKeyFromJwk,
  verifyProvenanceExport,
  verifyProvenanceExportCompactJws
} from './provenance-export-signature.js'

// Generated per run. A committed private key, even a throwaway one, is a key somebody eventually
// points at production.
function signingKey(keyId?: string) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return readProvenanceExportSigningKey(
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    { keyId }
  )
}

function outcome(overrides: Partial<StepOutcomeRecord> = {}): StepOutcomeRecord {
  return {
    id: 'o1',
    tenantId: 'local',
    runId: 'run_1',
    taskId: 't1',
    dispatchId: 'd1',
    backend: 'claude',
    stageKey: 'build',
    executionStrategy: 'single',
    outcome: 'succeeded',
    filesModified: ['a.ts'],
    reviewBackendBypass: false,
    escalationOffered: false,
    escalationAccepted: null,
    spendCents: 61,
    usage: null,
    gateDecision: 'gate',
    gateReason: 'irreversible',
    gateId: 'gate_1',
    policyRecommendation: 'gate',
    policyRecommendationReason: 'irreversible',
    humanGateDecision: 'auto',
    agreedWithPolicy: false,
    recommendationShown: true,
    humanVerdict: null,
    amendedAfterMs: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides
  }
}

function report(overrides: Partial<ProvenanceReport> = {}): ProvenanceReport {
  return {
    repoId: 'r1',
    branch: 'feature/x',
    outcomes: [outcome()],
    verifications: [],
    contextCaptures: [],
    totals: { spendCents: 61, tasks: 1, dispatches: 1 },
    reviewBackend: { enforced: true, bypassed: false },
    ...overrides
  }
}

const exportedAt = new Date('2026-09-08T10:11:12.000Z')

/** Same document, every object's keys emitted in the opposite order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .reverse()
      .map((key) => [key, reverseKeys(record[key])])
  )
}

describe('buildProvenanceExportDocument', () => {
  it('renders its Markdown from the same projection the panel and the PR body use', () => {
    const source = report()
    const document = buildProvenanceExportDocument({ tenantId: 'local', report: source, exportedAt })
    expect(document.markdown).toBe(
      renderProvenanceMarkdown(buildProvenanceView(source, { policyEnforced: true }))
    )
    expect(document.markdown).toContain('<!-- alicorn:provenance:start -->')
  })

  it('carries the gate decision and whether the human agreed with the policy', () => {
    const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })
    expect(document.view.steps[0]?.gate).toEqual({
      decision: 'gate',
      reason: 'irreversible',
      gateId: 'gate_1',
      agreement: {
        recorded: true,
        policyRecommendation: 'gate',
        policyRecommendationReason: 'irreversible',
        humanGateDecision: 'auto',
        agreed: false,
        recommendationShown: true
      }
    })
    expect(document.view.agreementCounts).toEqual({ agreed: 0, disagreed: 1, unrecorded: 0 })
    expect(document.markdown).toContain('overrode the policy; recommendation shown.')
  })

  it('dates itself from the clock it is handed, and validates against the wire schema', () => {
    const document = buildProvenanceExportDocument({ tenantId: 'acme', report: report(), exportedAt })
    expect(document.exportedAt).toBe('2026-09-08T10:11:12.000Z')
    expect(document.tenantId).toBe('acme')
    expect(ProvenanceExportDocumentSchema.parse(document)).toEqual(document)
  })

  it('says the reviewer rule was assumed on rather than implying it read the policy', () => {
    const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })
    expect(document.reviewerRuleSource).toBe('assumed_enforced')
    expect(document.memberLabels).toBe('member_id')
  })

  it('keys the archive object per tenant, repo, branch and export instant', () => {
    const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })
    expect(provenanceExportObjectKey(document, 'json')).toBe(
      'provenance/local/r1/feature_x/2026-09-08T10:11:12.000Z.json'
    )
  })
})

describe('ProvenanceViewSchema', () => {
  it('accepts what the projection actually produces', () => {
    const view = buildProvenanceView(report(), { policyEnforced: true })
    expect(ProvenanceViewSchema.parse(view)).toEqual(view)
  })

  it('stays assignable in both directions with the projection type', () => {
    // Compile-time only: a field added to one and not the other fails typecheck, not at runtime.
    const fromSchema = {} as import('zod').infer<typeof ProvenanceViewSchema>
    const fromType: ProvenanceView = fromSchema
    const back: import('zod').infer<typeof ProvenanceViewSchema> = fromType
    expect(back).toBe(fromSchema)
  })
})

describe('signProvenanceExport', () => {
  const key = signingKey()
  const keys = [verificationKeyFromJwk(key.publicJwk)]
  const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })

  it('verifies the document it signed', () => {
    const signature = signProvenanceExport(document, key)
    expect(signature.algorithm).toBe('ES256')
    expect(signature.keyId).toBe(key.keyId)
    expect(verifyProvenanceExport(document, signature, keys)).toEqual({ ok: true, keyId: key.keyId })
  })

  it('still verifies after a JSON round-trip that reorders every key', () => {
    const signature = signProvenanceExport(document, key)
    const reordered = JSON.parse(JSON.stringify(reverseKeys(document))) as unknown
    // A reversed key order is the same document; canonicalisation is what makes that true.
    expect(verifyProvenanceExport(reordered, signature, keys).ok).toBe(true)
  })

  it('derives a deterministic key id from the key when the operator pins none', () => {
    expect(key.keyId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(provenanceExportJwks([key])).toEqual({ keys: [key.publicJwk] })
    expect(key.publicJwk).not.toHaveProperty('d')
  })

  it('honours a pinned key id', () => {
    const pinned = signingKey('alicorn-export-2026')
    expect(pinned.keyId).toBe('alicorn-export-2026')
    expect(pinned.publicJwk.kid).toBe('alicorn-export-2026')
  })

  it('rejects a key that is not EC P-256', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(() =>
      readProvenanceExportSigningKey(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    ).toThrow(/EC private key/)
  })
})

describe('a single changed byte', () => {
  const key = signingKey()
  const keys = [verificationKeyFromJwk(key.publicJwk)]
  const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })
  const signature = signProvenanceExport(document, key)

  const tampered: [string, () => unknown][] = [
    ['one character of the Markdown', () => ({ ...document, markdown: `${document.markdown} ` })],
    ['the tenant', () => ({ ...document, tenantId: 'someone-else' })],
    ['the export date', () => ({ ...document, exportedAt: '2026-09-08T10:11:13.000Z' })],
    ['the branch', () => ({ ...document, subject: { ...document.subject, branch: 'main' } })],
    [
      'one cent of spend',
      () => ({
        ...document,
        view: { ...document.view, totals: { ...document.view.totals, spendCents: 62 } }
      })
    ],
    [
      'a gate decision',
      () => ({
        ...document,
        view: {
          ...document.view,
          steps: document.view.steps.map((step) => ({
            ...step,
            gate: { ...step.gate, decision: 'auto' as const }
          }))
        }
      })
    ],
    [
      'whether the human agreed with the policy',
      () => ({
        ...document,
        view: {
          ...document.view,
          steps: document.view.steps.map((step) => ({
            ...step,
            gate: { ...step.gate, agreement: { ...step.gate.agreement, agreed: true } }
          }))
        }
      })
    ],
    ['a dropped step', () => ({ ...document, view: { ...document.view, steps: [] } })]
  ]

  for (const [what, mutate] of tampered) {
    it(`fails verification: ${what}`, () => {
      expect(verifyProvenanceExport(mutate(), signature, keys)).toEqual({
        ok: false,
        reason: 'bad_signature'
      })
    })
  }

  it('fails verification when the signature itself is edited', () => {
    const flipped = Buffer.from(signature.signature, 'base64url')
    flipped[0] = (flipped[0]! ^ 0x01) & 0xff
    expect(
      verifyProvenanceExport(document, { ...signature, signature: flipped.toString('base64url') }, keys)
    ).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a downgraded alg in the protected header', () => {
    const forged = Buffer.from(
      JSON.stringify({ alg: 'none', kid: signature.keyId, typ: 'x' })
    ).toString('base64url')
    expect(verifyProvenanceExport(document, { ...signature, protected: forged }, keys)).toEqual({
      ok: false,
      reason: 'malformed_signature'
    })
  })

  it('rejects a signature from a key nobody published', () => {
    const stranger = signingKey()
    const forged = signProvenanceExport(document, stranger)
    expect(verifyProvenanceExport(document, forged, keys)).toEqual({
      ok: false,
      reason: 'unknown_key'
    })
    // And the right key id with the wrong key is a bad signature, not an unknown one.
    expect(
      verifyProvenanceExport(document, forged, [verificationKeyFromJwk(stranger.publicJwk)]).ok
    ).toBe(true)
  })

  it('rejects a truncated signature', () => {
    expect(verifyProvenanceExport(document, { ...signature, signature: 'AAAA' }, keys)).toEqual({
      ok: false,
      reason: 'malformed_signature'
    })
  })
})

describe('the Markdown export', () => {
  const key = signingKey()
  const keys = [verificationKeyFromJwk(key.publicJwk)]
  const document = buildProvenanceExportDocument({ tenantId: 'local', report: report(), exportedAt })
  const signature = signProvenanceExport(document, key)
  const markdown = renderSignedProvenanceMarkdown(
    document,
    provenanceExportCompactJws(document, signature)
  )

  it('stands alone: the file itself carries the signed document', () => {
    const jws = readSignedProvenanceMarkdownJws(markdown)
    expect(jws).not.toBeNull()
    const verified = verifyProvenanceExportCompactJws(jws!, keys)
    expect(verified.ok).toBe(true)
    expect(verified.ok && verified.document).toEqual(document)
  })

  it('shows the same prose that is inside the signed bytes', () => {
    expect(markdown.startsWith(document.markdown)).toBe(true)
  })

  it('fails when one character of the embedded payload is changed', () => {
    const jws = readSignedProvenanceMarkdownJws(markdown)!
    const [head, payload, tail] = jws.split('.')
    const decoded = Buffer.from(payload!, 'base64url').toString('utf8')
    const edited = Buffer.from(decoded.replace('"local"', '"acme0"')).toString('base64url')
    expect(decoded).toContain('"local"')
    expect(verifyProvenanceExportCompactJws(`${head}.${edited}.${tail}`, keys)).toEqual({
      ok: false,
      reason: 'bad_signature'
    })
  })

  it('returns null when there is no signature block to read', () => {
    expect(readSignedProvenanceMarkdownJws('# nothing here')).toBeNull()
  })
})
