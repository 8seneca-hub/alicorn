import {
  appendJournalLog,
  openRunJournal,
  recordContractScan,
  updateRunJournal
} from './journal-writer'
import { journalPath } from './journal'
import { isContractRegistryEmpty } from './contract-registry'
import { scanRepoContracts } from './repo-contract-scan'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'

/** Only the worktree fields run start needs: the disk to write, and whose disk it is. */
export type RunJournalWorktree = { path?: string | null; hostId?: string | null }

/**
 * FJ1 — opens the run's Feature Journal and fills its Contract Registry, once, at run start.
 *
 * Run start for an orchestrated run is the **lead's dispatch**. `CoordinatorForemanJournal` does
 * this too, but its only non-test caller is inside `orchestration.run`, which the contract fence
 * refuses as `command_retired` — so in a running app nothing had ever written a journal, and CR2's
 * contract gate read an absent one as `no_contract_registry` and passed.
 *
 * Refuses a worktree on another execution host, exactly as `journalComposedTeam` does: `path`
 * belongs to that host, so writing here would put the journal on the client's disk while the lead
 * reads the host's. Never fatal — a journal that could not be written costs the record, not the
 * dispatch.
 */
export async function seedRunJournal(input: {
  worktree: RunJournalWorktree | null | undefined
  runId: string
  objective: string
  now?: () => Date
}): Promise<boolean> {
  const worktree = input.worktree
  if (!worktree?.path) {
    return false
  }
  if (worktree.hostId && worktree.hostId !== LOCAL_EXECUTION_HOST_ID) {
    return false
  }
  const now = input.now ?? (() => new Date())
  const path = journalPath(worktree.path, input.runId)
  try {
    const journal = await openRunJournal(path, {
      runId: input.runId,
      objective: input.objective,
      startedAt: now().toISOString()
    })
    // Extraction is a run-start act: a re-dispatched lead adopts the registry it already has rather
    // than re-scanning over rows the run has since declared.
    if (!isContractRegistryEmpty(journal.contractRegistry)) {
      return true
    }
    const scan = await scanRepoContracts(worktree.path, { repo: '' })
    await updateRunJournal(path, (current) => {
      appendJournalLog(current, now().toISOString(), recordContractScan(current, scan))
    })
    return true
  } catch (error) {
    console.warn('[alicorn] run journal not seeded', error)
    return false
  }
}
