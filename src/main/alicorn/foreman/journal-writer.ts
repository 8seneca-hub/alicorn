import type { ForemanPlanNode } from '../../../shared/alicorn/foreman-run'
import { journalPath, readJournal, writeJournal, type Journal, type JournalStatus } from './journal'

export { journalPath }

/**
 * Every write is read-modify-write on what is already on disk.
 *
 * That is the whole resumability mechanism: the lead writes decisions, assumptions and the contract
 * registry into the same file the coordinator writes node status into, so a coordinator that
 * blind-rendered its own view of the run would erase the lead's reasoning on the next dispatch —
 * and the journal is the only record of it.
 */
export async function updateRunJournal(
  path: string,
  mutate: (journal: Journal) => void
): Promise<Journal | null> {
  const journal = await readJournal(path)
  if (!journal) {
    return null
  }
  mutate(journal)
  await writeJournal(path, journal)
  return journal
}

/**
 * Returns the journal for a run, creating it only if absent.
 *
 * Absent-only is deliberate: a coordinator restarting onto an existing run must adopt the journal
 * rather than start a fresh one, or the run loses every decision taken before the restart.
 */
export async function openRunJournal(
  path: string,
  seed: { runId: string; objective: string; startedAt: string }
): Promise<Journal> {
  const existing = await readJournal(path)
  if (existing) {
    return existing
  }
  const journal: Journal = {
    runId: seed.runId,
    objective: seed.objective,
    status: 'running',
    startedAt: seed.startedAt,
    budgetCents: null,
    spentCents: null,
    decisions: [],
    assumptions: [],
    plan: [],
    contractRegistry: '',
    log: [],
    notDone: []
  }
  await writeJournal(path, journal)
  return journal
}

/**
 * Merges one node into the plan, keeping fields the caller did not name.
 *
 * The coordinator owns status and dispatch id; the lead owns owner, model and dependencies. Neither
 * may overwrite the other's columns just by touching the node.
 */
export function upsertPlanNode(
  journal: Journal,
  node: Partial<ForemanPlanNode> & { id: string }
): void {
  const index = journal.plan.findIndex((existing) => existing.id === node.id)
  if (index === -1) {
    journal.plan.push({
      title: '',
      owner: '',
      dependsOn: [],
      status: 'pending',
      model: null,
      dispatchId: null,
      ...node
    })
    return
  }
  journal.plan[index] = { ...journal.plan[index]!, ...node }
}

/** Appended in run order; the log is what a human reads to reconstruct a run after the fact. */
export function appendJournalLog(journal: Journal, at: string, line: string): void {
  journal.log.push({ at, line })
}

export function setJournalStatus(journal: Journal, status: JournalStatus): void {
  journal.status = status
}
