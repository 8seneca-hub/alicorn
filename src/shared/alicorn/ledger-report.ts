// Hand-mirrored from cloud/packages/control-plane-contract/src/ledger.ts
// (InterruptionsReportSchema) — the read side only, kept separate from
// ledger.ts because that file belongs to the ledger-writer engineer.

export type InterruptionsReportFilters = {
  stageKey?: string
  projectId?: string
  memberId?: string
  since?: string
  until?: string
}

export type InterruptionsReportByStage = {
  stageKey: string
  completedTasks: number
  interruptions: number
  perCompletedTask: number
}

export type InterruptionsReport = {
  filters: InterruptionsReportFilters
  completedTasks: number
  interruptions: number
  perCompletedTask: number
  byKind: Record<string, number>
  byStage: InterruptionsReportByStage[]
  excluded: 'permission_prompt'[]
}
