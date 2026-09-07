// Wire shape for `ledger.outboxList`, shared by the RPC method, the CLI handler and its
// test — the same pattern `ledger.report` uses via InterruptionsReport in ledger-report.ts.

export type OutboxListRow = {
  id: string
  kind: string
  dedupeKey: string
  attempts: number
  lastError: string | null
  notBefore: string | null
  deadAt: string | null
  deadReason: string | null
  createdAt: string
}

/** Whole-table totals. Optional so an older host that omits them still parses (additive wire change). */
export type OutboxCounts = { pending: number; sent: number; dead: number }

export type OutboxListResult = {
  rows: OutboxListRow[]
  deadCount: number
  counts?: OutboxCounts
}
