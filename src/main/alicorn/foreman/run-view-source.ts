import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ForemanRunView, ForemanRunViewResult } from '../../../shared/alicorn/foreman-run'
import { JournalParseError, readJournal, type Journal } from './journal'

const JOURNAL_DIR = '.foreman'

/**
 * Reads the journal a workspace's run is keeping, without consulting the orchestration DB.
 *
 * Disk-first on purpose: the journal is the source of truth and a run survives the session that
 * started it (ARCHITECTURE, *state is on disk*), so a view that reads the DB would go blank on
 * exactly the restart the journal exists to survive.
 */
export async function readForemanRunView(
  worktreePath: string,
  deps: { readJournalAt?: typeof readJournal } = {}
): Promise<ForemanRunViewResult> {
  const read = deps.readJournalAt ?? readJournal
  const runIds = await listRunIdsNewestFirst(join(worktreePath, JOURNAL_DIR))
  if (runIds.length === 0) {
    return { state: 'none' }
  }
  // Newest first, so a workspace that has hosted several runs shows the current one.
  for (const runId of runIds) {
    try {
      const journal = await read(join(worktreePath, JOURNAL_DIR, runId, 'journal.md'))
      if (journal) {
        return { state: 'ready', run: toRunView(journal) }
      }
    } catch (error) {
      // Why stop rather than fall back to an older run: a journal that does not parse is the one
      // the user needs told about. Silently drawing a previous run would be a lie about the state.
      return {
        state: 'unreadable',
        reason: error instanceof JournalParseError ? error.message : describe(error)
      }
    }
  }
  return { state: 'none' }
}

function toRunView(journal: Journal): ForemanRunView {
  return {
    runId: journal.runId,
    objective: journal.objective,
    status: journal.status,
    startedAt: journal.startedAt,
    budgetCents: journal.budgetCents,
    plan: journal.plan
  }
}

async function listRunIdsNewestFirst(journalDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = (await readdir(journalDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    // Absent `.foreman/` is the ordinary case: most workspaces run nothing orchestrated.
    return []
  }
  const timed = await Promise.all(
    entries.map(async (name) => ({ name, at: await modifiedAt(join(journalDir, name)) }))
  )
  return timed.sort((left, right) => right.at - left.at).map((entry) => entry.name)
}

async function modifiedAt(path: string): Promise<number> {
  try {
    return (await stat(join(path, 'journal.md'))).mtimeMs
  } catch {
    return 0
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
