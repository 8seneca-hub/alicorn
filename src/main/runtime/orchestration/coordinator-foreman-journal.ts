import { ForemanJournalRecorder } from '../../alicorn/foreman/journal-writer'
import type { OrchestrationDb } from './db'

// Why a seam here rather than calls inside coordinator.ts: the coordinator is at the line cap, and
// the journal is Foreman's concern — a run with no orchestrated task must behave exactly as before.
export function createForemanJournalRecorder(options: {
  db: OrchestrationDb
  runId: string
  spec: string
  worktree: string | undefined
  onLog: (message: string) => void
}): ForemanJournalRecorder | null {
  // No worktree means no repository to write `.foreman/` into; the run still works, unjournalled.
  if (!options.worktree) {
    return null
  }
  return new ForemanJournalRecorder({
    db: options.db,
    runId: options.runId,
    worktreePath: options.worktree,
    objective: options.spec,
    onLog: options.onLog
  })
}

export type { ForemanJournalRecorder }
