export type LedgerOutboxKind =
  | 'step_outcome'
  | 'context_capture'
  | 'spend_attribution'
  | 'step_verification'

// Why: raw `ledger_outbox` row, mirrors the SQLite columns directly (no camelCase mapping).
export type LedgerOutboxRow = {
  id: string
  kind: LedgerOutboxKind
  dedupe_key: string
  payload: string
  attempts: number
  not_before: string | null
  last_error: string | null
  created_at: string
  sent_at: string | null
}

export type TaskExecutionStrategy = 'single' | 'orchestrated'
export type TaskExecutionStrategySource = 'default' | 'user' | 'escalation'

export type TaskExecutionStrategyRow = {
  strategy: TaskExecutionStrategy
  source: TaskExecutionStrategySource
  escalationOfferedAt: string | null
  escalationAcceptedAt: string | null
}

export type DispatchMemberRow = {
  dispatchId: string
  memberId: string
  memberRole: string
  backend: string
  reviewBackendBypass: boolean
}
