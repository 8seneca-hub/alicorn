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

export type OutboxListResult = { rows: OutboxListRow[]; deadCount: number }
