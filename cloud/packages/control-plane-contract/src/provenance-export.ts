import { z } from 'zod'
import { GateDecisionReasonSchema } from './autonomy-policy.js'
import { ExecutionStrategySchema, type ProvenanceReport } from './ledger.js'
import { MemberBackendSchema } from './member.js'
import { buildProvenanceView, type ProvenanceView } from './provenance-view.js'
import { renderProvenanceMarkdown } from './provenance-markdown.js'
import type { ProvenanceExportSignature } from './provenance-export-signature.js'

/**
 * PV2. The audit artefact: one dated, signed document holding the whole decision trail for a
 * branch — the projection PV1's panel renders, the Markdown D6 puts in the pull request, and the
 * gate decisions with whether the human agreed with the policy.
 *
 * `markdown` is inside the document on purpose. It is not a second rendering of the ledger — it is
 * `renderProvenanceMarkdown(view)`, the same function the panel and the PR body use — and being
 * inside the signed bytes is what makes the human-readable half as attestable as the structured
 * half.
 */
export const PROVENANCE_EXPORT_FORMAT = 'alicorn.provenance.export'
export const PROVENANCE_EXPORT_VERSION = 1

export const ProvenanceGateAgreementSchema = z.union([
  z.object({ recorded: z.literal(false) }),
  z.object({
    recorded: z.literal(true),
    policyRecommendation: z.enum(['gate', 'auto']),
    policyRecommendationReason: z.string(),
    humanGateDecision: z.enum(['gate', 'auto']),
    agreed: z.boolean(),
    recommendationShown: z.boolean()
  })
])

export const ProvenanceStepViewSchema = z.object({
  id: z.string(),
  dispatchId: z.string(),
  runId: z.string(),
  taskId: z.string(),
  stageKey: z.string(),
  member: z.string().nullable(),
  backend: z.union([MemberBackendSchema, z.literal('other'), z.literal('code')]),
  executionStrategy: ExecutionStrategySchema,
  outcome: z.enum(['succeeded', 'failed']),
  filesModified: z.number().int(),
  spendCents: z.number().int().nullable(),
  gate: z.object({
    decision: z.enum(['gate', 'auto', 'unknown']),
    reason: z.union([GateDecisionReasonSchema, z.literal('unknown')]),
    gateId: z.string().nullable(),
    agreement: ProvenanceGateAgreementSchema
  }),
  reportSummary: z.string(),
  createdAt: z.string()
})

export const ProvenanceViewSchema = z.object({
  repoId: z.string(),
  branch: z.string(),
  totals: z.object({
    tasks: z.number().int(),
    dispatches: z.number().int(),
    spendCents: z.number().int().nullable()
  }),
  steps: z.array(ProvenanceStepViewSchema),
  checks: z.array(
    z.object({
      dispatchId: z.string(),
      kind: z.enum(['diff_coverage', 'contract_acknowledged', 'integration_verify']),
      name: z.string(),
      required: z.boolean(),
      status: z.enum(['passed', 'failed', 'skipped', 'error']),
      ratio: z.number().nullable()
    })
  ),
  reviewerRule: z.enum(['bypassed', 'enforced', 'not-enforced']),
  escalation: z.union([
    z.object({ offered: z.literal(false) }),
    z.object({
      offered: z.literal(true),
      stageKey: z.string(),
      verdict: z.enum(['accepted', 'declined', 'unanswered'])
    })
  ]),
  contextCaptureCount: z.number().int(),
  gateCounts: z.object({ gate: z.number().int(), auto: z.number().int(), unknown: z.number().int() }),
  agreementCounts: z.object({
    agreed: z.number().int(),
    disagreed: z.number().int(),
    unrecorded: z.number().int()
  })
})

/**
 * `reviewerRuleSource` is honest rather than convenient. The Ledger API holds no org policy — that
 * is the Control API's — and there is no cross-service lookup on this path, so an export states
 * that it assumed the rule was on. Assuming it off would understate a bypass, which is the one
 * direction an audit artefact must never lean.
 */
export const ProvenanceExportDocumentSchema = z.object({
  format: z.literal(PROVENANCE_EXPORT_FORMAT),
  version: z.literal(PROVENANCE_EXPORT_VERSION),
  tenantId: z.string().min(1),
  subject: z.object({ repoId: z.string(), branch: z.string() }),
  /** Server clock at export. `client_ts` is forensics only and never dates an export. */
  exportedAt: z.string().datetime(),
  reviewerRuleSource: z.enum(['assumed_enforced', 'org_policy']),
  /** Member ids, not names: the Ledger API has no member directory, and an id does not go stale. */
  memberLabels: z.literal('member_id'),
  view: ProvenanceViewSchema,
  markdown: z.string()
})

export type ProvenanceExportDocument = z.infer<typeof ProvenanceExportDocumentSchema>

export const ProvenanceExportSignatureSchema = z.object({
  algorithm: z.literal('ES256'),
  keyId: z.string().min(1),
  protected: z.string().min(1),
  signature: z.string().min(1),
  payloadSha256: z.string().min(1)
})

export const ProvenanceExportArchiveResultSchema = z.union([
  z.object({ stored: z.literal(true), uri: z.string().min(1) }),
  z.object({ stored: z.literal(false), reason: z.enum(['not_configured', 'failed']) })
])
export type ProvenanceExportArchiveResult = z.infer<typeof ProvenanceExportArchiveResultSchema>

export const ProvenanceExportEnvelopeSchema = z.object({
  document: ProvenanceExportDocumentSchema,
  signature: ProvenanceExportSignatureSchema,
  archive: ProvenanceExportArchiveResultSchema
})
export type ProvenanceExportEnvelope = {
  document: ProvenanceExportDocument
  signature: ProvenanceExportSignature
  archive: ProvenanceExportArchiveResult
}

export function buildProvenanceExportDocument(input: {
  tenantId: string
  report: ProvenanceReport
  exportedAt: Date
}): ProvenanceExportDocument {
  const view: ProvenanceView = buildProvenanceView(input.report, { policyEnforced: true })
  return {
    format: PROVENANCE_EXPORT_FORMAT,
    version: PROVENANCE_EXPORT_VERSION,
    tenantId: input.tenantId,
    subject: { repoId: input.report.repoId, branch: input.report.branch },
    exportedAt: input.exportedAt.toISOString(),
    reviewerRuleSource: 'assumed_enforced',
    memberLabels: 'member_id',
    view,
    markdown: renderProvenanceMarkdown(view)
  }
}

/** A stable, tenant-scoped object key. Two exports of the same branch never collide, never overwrite. */
export function provenanceExportObjectKey(document: ProvenanceExportDocument, extension: 'json' | 'md'): string {
  const slug = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
  return `provenance/${slug(document.tenantId)}/${slug(document.subject.repoId)}/${slug(document.subject.branch)}/${document.exportedAt}.${extension}`
}

const MARKDOWN_SIGNATURE_START = '<!-- alicorn:export:signature'
const MARKDOWN_SIGNATURE_END = '-->'

/**
 * The Markdown rendering with the whole signed document attached as a compact JWS, so the file an
 * auditor is handed verifies on its own. The prose above the footer is a convenience; the footer is
 * the evidence, and the prose is inside it.
 */
export function renderSignedProvenanceMarkdown(
  document: ProvenanceExportDocument,
  compactJws: string
): string {
  return [
    document.markdown,
    '',
    `<!-- Exported by Alicorn at ${document.exportedAt} (server clock). Verify the block below with the`,
    `     ES256 public key published at /.well-known/alicorn-provenance-jwks.json. -->`,
    MARKDOWN_SIGNATURE_START,
    compactJws,
    MARKDOWN_SIGNATURE_END,
    ''
  ].join('\n')
}

export function readSignedProvenanceMarkdownJws(markdown: string): string | null {
  const start = markdown.lastIndexOf(MARKDOWN_SIGNATURE_START)
  if (start === -1) {
    return null
  }
  const end = markdown.indexOf(MARKDOWN_SIGNATURE_END, start + MARKDOWN_SIGNATURE_START.length)
  if (end === -1) {
    return null
  }
  const body = markdown.slice(start + MARKDOWN_SIGNATURE_START.length, end).trim()
  return body.length > 0 ? body : null
}
