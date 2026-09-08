// Hand-mirrored from cloud/packages/control-plane-contract/src/ledger.ts
// (InterruptionsReportSchema) — the read side only, kept separate from
// ledger.ts because that file belongs to the ledger-writer engineer.

export type InterruptionsReportFilters = {
  stageKey?: string
  projectId?: string
  memberId?: string
  runId?: string
  executionStrategy?: 'single' | 'orchestrated'
  since?: string
  until?: string
}

// Which rule the ledger used for `completedTasks`. Only the first is implemented today; the others
// are declared so a later switch is not a wire change.
export type CompletedTaskDefinition =
  | 'any_successful_step'
  | 'terminal_stage_succeeded'
  | 'no_failed_step_outstanding'

export type InterruptionsReportByStage = {
  stageKey: string
  completedTasks: number
  tasksTouched: number
  interruptions: number
  perCompletedTask: number
  perTaskTouched: number
}

export type InterruptionsReport = {
  filters: InterruptionsReportFilters
  completedTaskDefinition: CompletedTaskDefinition
  completedTasks: number
  // The loose denominator — every task with a settled outcome, failed included. Carried beside the
  // strict count so a divergence is visible rather than averaged away.
  tasksTouched: number
  interruptions: number
  perCompletedTask: number
  perTaskTouched: number
  byKind: Record<string, number>
  byStage: InterruptionsReportByStage[]
  excluded: 'permission_prompt'[]
}
