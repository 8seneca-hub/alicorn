export type LedgerOutboxKind =
  | 'step_outcome'
  | 'context_capture'
  | 'spend_attribution'
  | 'step_verification'
  | 'human_verdict_patch'
  | 'interruption'

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

// Why: a dispatch's alicorn_dispatch_members row is only written once a Member is
// assigned; an unassigned worker still needs cost attribution from its start_options.
export type ActiveOrRecentDispatchRow = {
  dispatchId: string
  worktreeId: string | null
  startOptions: string
  /** Null when no alicorn_dispatch_members row exists — fall back to startOptions. */
  memberBackend: string | null
  dispatchedAt: string | null
  completedAt: string | null
}

export type BoardTransitionOutcome =
  | 'dispatched'
  | 'refused_ceiling'
  | 'refused_loop'
  | 'refused_killed'

export type BoardTransitionRow = {
  id: string
  repoId: string
  worktreeId: string
  taskId: string | null
  dispatchId: string | null
  fromStatusId: string | null
  toStatusId: string
  ruleId: string
  outcome: BoardTransitionOutcome
  createdAt: string
}

// Why: scope is 'global' or 'board:<repoId>'; an absent row reads as enabled.
export type BoardAutomationStateRow = {
  scope: string
  disabledAt: string | null
  disabledBy: string | null
}
