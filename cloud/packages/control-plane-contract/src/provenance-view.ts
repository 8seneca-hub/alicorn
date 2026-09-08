// One assembly of a run's provenance, shared by the three surfaces that explain it: D6's
// pull-request body (a stranger, once), PV1's panel (the developer, while working) and PV2's
// signed export (an auditor, later). Structured only — no prose and no icons — because the panel
// localises its copy while the PR body and the export must stay English.
//
// CANONICAL COPY. The desktop mirrors this file at src/shared/alicorn/provenance-view.ts because
// the two workspaces do not share a package graph; `provenance-projection-parity.test.ts` fails if
// the two bodies diverge by a byte.

import { GATE_DECISION_REASONS, type GateDecisionReason } from './autonomy-policy.js'
import type {
  ExecutionStrategy,
  ProvenanceReport,
  StepOutcomeBackend,
  StepOutcomeRecord,
  StepVerificationRecord
} from './ledger.js'

const MAX_REPORT_SUMMARY_CHARS = 200

export type MemberNameLookup = (memberId: string) => string | undefined

/** `unknown` is a real answer: a step written before GP1, or a reason this build does not know. */
export type ProvenanceGateDecision = 'gate' | 'auto' | 'unknown'
export type ProvenanceGateReason = GateDecisionReason | 'unknown'

export type ProvenanceGateView = {
  decision: ProvenanceGateDecision
  reason: ProvenanceGateReason
  /** GP1's gate row this decision belongs to; `null` for a step that never opened one. */
  gateId: string | null
  /** GP3: what the policy would have decided, and what the human decided, side by side. */
  agreement: ProvenanceGateAgreement
}

/**
 * Whether the human agreed with the policy. `unrecorded` is the honest answer for every step
 * written before GP3 and for every step no human ever ruled on — never `agreed`, which would
 * read as an endorsement nobody gave.
 */
export type ProvenanceGateAgreement =
  | { recorded: false }
  | {
      recorded: true
      policyRecommendation: 'gate' | 'auto'
      policyRecommendationReason: string
      humanGateDecision: 'gate' | 'auto'
      agreed: boolean
      /** Was the recommendation on screen when they decided? Reported by the surface, never inferred. */
      recommendationShown: boolean
    }

export type ProvenanceStepView = {
  id: string
  dispatchId: string
  /** UI3 groups a branch's steps by run; the ledger keys captures and cost by it. */
  runId: string
  taskId: string
  stageKey: string
  /** The member's name when the directory knows it, else its id, else `null` for no member. */
  member: string | null
  backend: StepOutcomeBackend
  executionStrategy: ExecutionStrategy
  outcome: 'succeeded' | 'failed'
  filesModified: number
  spendCents: number | null
  gate: ProvenanceGateView
  /** First line of the worker's report, trimmed; empty when it filed none. */
  reportSummary: string
  createdAt: string
}

export type ProvenanceCheckView = {
  /** Which dispatch was verified — a branch-level list cannot say who earned the check. */
  dispatchId: string
  kind: StepVerificationRecord['kind']
  name: string
  required: boolean
  status: StepVerificationRecord['status']
  /** Coverage ratio when the check reported one; null when it did not. */
  ratio: number | null
}

export type ProvenanceReviewerRule = 'bypassed' | 'enforced' | 'not-enforced'

export type ProvenanceEscalation =
  | { offered: false }
  | { offered: true; stageKey: string; verdict: 'accepted' | 'declined' | 'unanswered' }

export type ProvenanceView = {
  repoId: string
  branch: string
  totals: { tasks: number; dispatches: number; spendCents: number | null }
  steps: ProvenanceStepView[]
  checks: ProvenanceCheckView[]
  reviewerRule: ProvenanceReviewerRule
  escalation: ProvenanceEscalation
  contextCaptureCount: number
  /** How the run split between decisions — the headline answer to "was a human asked?". */
  gateCounts: { gate: number; auto: number; unknown: number }
  /** The other half of that answer: when a human ruled, did they rule with the policy or against it? */
  agreementCounts: { agreed: number; disagreed: number; unrecorded: number }
}

export function isGateDecisionReason(value: string): value is GateDecisionReason {
  return (GATE_DECISION_REASONS as readonly string[]).includes(value)
}

/** `—` over a guess: a backend Alicorn does not price must never read as free. */
export function formatSpendCents(cents: number | null | undefined): string {
  return typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : '—'
}

export function firstReportLine(text: string | undefined): string {
  const line = (text ?? '').split('\n', 1)[0]?.trim() ?? ''
  return line.length > MAX_REPORT_SUMMARY_CHARS
    ? `${line.slice(0, MAX_REPORT_SUMMARY_CHARS - 1)}…`
    : line
}

function gateAgreement(outcome: StepOutcomeRecord): ProvenanceGateAgreement {
  // All four columns or none: a partial row cannot say what the human was shown or chose.
  if (
    !outcome.policyRecommendation ||
    !outcome.humanGateDecision ||
    typeof outcome.agreedWithPolicy !== 'boolean'
  ) {
    return { recorded: false }
  }
  return {
    recorded: true,
    policyRecommendation: outcome.policyRecommendation,
    policyRecommendationReason: outcome.policyRecommendationReason ?? 'unknown',
    humanGateDecision: outcome.humanGateDecision,
    agreed: outcome.agreedWithPolicy,
    recommendationShown: outcome.recommendationShown === true
  }
}

function gateView(outcome: StepOutcomeRecord): ProvenanceGateView {
  const decision: ProvenanceGateDecision =
    outcome.gateDecision === 'gate' || outcome.gateDecision === 'auto'
      ? outcome.gateDecision
      : 'unknown'
  const reason: ProvenanceGateReason = isGateDecisionReason(outcome.gateReason)
    ? outcome.gateReason
    : 'unknown'
  return { decision, reason, gateId: outcome.gateId ?? null, agreement: gateAgreement(outcome) }
}

function memberLabel(outcome: StepOutcomeRecord, lookup?: MemberNameLookup): string | null {
  if (!outcome.memberId) {
    return null
  }
  return lookup?.(outcome.memberId) ?? outcome.memberId
}

function checkRatio(detail: Record<string, unknown>): number | null {
  const ratio = detail?.ratio
  return typeof ratio === 'number' ? ratio : null
}

function escalationView(outcomes: readonly StepOutcomeRecord[]): ProvenanceEscalation {
  const escalated = outcomes.find((outcome) => outcome.escalationOffered)
  if (!escalated) {
    return { offered: false }
  }
  return {
    offered: true,
    stageKey: escalated.stageKey,
    verdict:
      escalated.escalationAccepted === true
        ? 'accepted'
        : escalated.escalationAccepted === false
          ? 'declined'
          : 'unanswered'
  }
}

function reviewerRule(report: ProvenanceReport, policyEnforced: boolean): ProvenanceReviewerRule {
  if (report.reviewBackend.bypassed) {
    return 'bypassed'
  }
  return policyEnforced ? 'enforced' : 'not-enforced'
}

export function buildProvenanceView(
  report: ProvenanceReport,
  opts: { policyEnforced: boolean; memberName?: MemberNameLookup }
): ProvenanceView {
  const steps = report.outcomes.map<ProvenanceStepView>((outcome) => ({
    id: outcome.id,
    dispatchId: outcome.dispatchId,
    runId: outcome.runId,
    taskId: outcome.taskId,
    stageKey: outcome.stageKey,
    member: memberLabel(outcome, opts.memberName),
    backend: outcome.backend,
    executionStrategy: outcome.executionStrategy,
    outcome: outcome.outcome,
    filesModified: outcome.filesModified.length,
    spendCents: outcome.spendCents,
    gate: gateView(outcome),
    reportSummary: firstReportLine(outcome.reportSummary),
    createdAt: outcome.createdAt
  }))
  const gateCounts = { gate: 0, auto: 0, unknown: 0 }
  const agreementCounts = { agreed: 0, disagreed: 0, unrecorded: 0 }
  for (const step of steps) {
    gateCounts[step.gate.decision] += 1
    const { agreement } = step.gate
    if (!agreement.recorded) {
      agreementCounts.unrecorded += 1
    } else if (agreement.agreed) {
      agreementCounts.agreed += 1
    } else {
      agreementCounts.disagreed += 1
    }
  }
  return {
    repoId: report.repoId,
    branch: report.branch,
    totals: {
      tasks: report.totals.tasks,
      dispatches: report.totals.dispatches,
      spendCents: report.totals.spendCents
    },
    steps,
    checks: report.verifications.map<ProvenanceCheckView>((verification) => ({
      dispatchId: verification.dispatchId,
      kind: verification.kind,
      name: verification.name,
      required: verification.required,
      status: verification.status,
      ratio: checkRatio(verification.detail)
    })),
    reviewerRule: reviewerRule(report, opts.policyEnforced),
    escalation: escalationView(report.outcomes),
    contextCaptureCount: report.contextCaptures.length,
    gateCounts,
    agreementCounts
  }
}

/** What the panel asks for and what it gets back. Never rejects: the panel renders the failure. */
export type ProvenanceViewResult = { ok: true; view: ProvenanceView } | { ok: false; error: string }
