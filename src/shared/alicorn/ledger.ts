// Hand-mirrored from cloud/packages/control-plane-contract/src/ledger.ts —
// the read side only. Ledger writes belong to C3's writer, not to this client.

import type { MemberBackend } from './members'

export const EXECUTION_STRATEGIES = ['single', 'orchestrated'] as const
export type ExecutionStrategy = (typeof EXECUTION_STRATEGIES)[number]

// `other` covers agents Alicorn launches but Alicorn does not price or police. `code` is a stage that
// ran a command instead of a model — deliberately not a `MemberBackend`, because no member can be
// configured to run one.
export type StepOutcomeBackend = MemberBackend | 'other' | 'code'

export type StepOutcomeRecord = {
  id: string
  tenantId: string
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
  spendCents: number | null
  usage: Record<string, unknown> | null
  gateDecision: string
  gateReason: string
  gateId: string | null
  /** GP3: null on a gate opened without `evaluate`, or a step that never opened one. */
  policyRecommendation: 'gate' | 'auto' | null
  policyRecommendationReason: string | null
  humanGateDecision: 'gate' | 'auto' | null
  agreedWithPolicy: boolean | null
  recommendationShown: boolean | null
  createdAt: string
}

export type StepVerificationRecord = {
  id: string
  runId: string
  taskId: string
  dispatchId: string
  kind: 'diff_coverage' | 'contract_acknowledged' | 'integration_verify'
  name: string
  required: boolean
  status: 'passed' | 'failed' | 'skipped' | 'error'
  detail: Record<string, unknown>
  createdAt: string
}

export type ProvenanceReport = {
  repoId: string
  branch: string
  outcomes: StepOutcomeRecord[]
  verifications: StepVerificationRecord[]
  contextCaptures: { dispatchId: string; promptBytes: number; createdAt: string }[]
  totals: { spendCents: number; tasks: number; dispatches: number }
  reviewBackend: { enforced: boolean; bypassed: boolean }
}

export type RunCost = {
  runId: string
  totalSpendCents: number
  byDispatch: {
    dispatchId: string
    taskId: string
    backend: string
    spendCents: number | null
  }[]
}

// Mirrors ContextCaptureReadSchema in the wire contract. Distinct from the write shape on purpose:
// a reader must be able to tell a prompt spilled to a file from one held inline, never collapse
// the two into one field.
export type ContextCaptureRead = {
  dispatchId: string
  createdAt: string
  /** The *inline* prompt's size. Zero for a spilled capture — the write side never measures the file. */
  promptBytes: number
  prompt: string | null
  promptPath: string | null
  contextSlice: unknown
}

export type ContextCaptureList = {
  captures: ContextCaptureRead[]
  /** The run held more captures than the Ledger API returns; the list below is a prefix. */
  truncated: boolean
}
