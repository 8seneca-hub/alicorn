// Hand-mirrored from cloud/packages/control-plane-contract/src/ledger.ts —
// the write side. Field names must stay identical to the zod input schemas.

import type { ExecutionStrategy, StepOutcomeBackend } from './ledger'

export type StepOutcomeInput = {
  runId: string
  taskId: string
  dispatchId: string
  projectId?: string
  repoId?: string
  worktreeId?: string
  branch?: string
  memberId?: string
  backend: StepOutcomeBackend
  stageKey: string
  executionStrategy: ExecutionStrategy
  outcome: 'succeeded' | 'failed'
  filesModified: string[]
  reportSummary?: string
  reviewBackendBypass: boolean
  escalationOffered: boolean
  escalationAccepted: boolean | null
  clientTs?: string
}

export type SpendPatch = {
  spendCents: number | null
  usage: Record<string, unknown> | null
}

export type StepVerificationInput = {
  runId: string
  taskId: string
  dispatchId: string
  kind: 'diff_coverage' | 'contract_acknowledged' | 'integration_verify'
  name: string
  required: boolean
  status: 'passed' | 'failed' | 'skipped' | 'error'
  detail: Record<string, unknown>
}

export type ContextCaptureInput = {
  runId: string
  taskId: string
  dispatchId: string
  // Why: exactly one of prompt / promptPath — overflow is written to a file and the path is recorded.
  prompt?: string
  promptPath?: string
  contextSlice: Record<string, unknown>
}

/**
 * GP3 (level 1 advisory). What the human decided *about the gate*, beside what the policy would
 * have decided. Deliberately not `HumanVerdictPatch`: that judges the work after the fact and is
 * written by the corrections sweep; this judges whether the interruption was warranted and is
 * written when the gate resolves. `agreedWithPolicy` is absent on purpose — the server derives it.
 */
export type GateAgreementPatch = {
  gateId: string
  policyRecommendation: 'gate' | 'auto'
  policyRecommendationReason: string
  humanGateDecision: 'gate' | 'auto'
  /** Whether the recommendation was on screen when the human decided. Never assumed true. */
  recommendationShown: boolean
}

export type HumanVerdictPatch = {
  humanVerdict: 'accepted' | 'rejected' | 'amended'
  amendedAfterMs: number | null
  // Why: what the corrections watcher saw — a follow-up commit, a revert, a reopened task, or a manual call.
  source: 'follow_up_commit' | 'revert' | 'reopened_task' | 'manual'
}

export type InterruptionInput = {
  runId: string
  taskId: string
  dispatchId: string
  kind: 'gate' | 'ask' | 'escalation'
  sourceId: string
  resolvedBy: string | null
  occurredAt: string
}
