import { appendJournalLog, openRunJournal, recordComposedTeam } from './journal-writer'
import { journalPath, readJournal, writeJournal } from './journal'
import { isTeamAccepted, type ComposedTeam } from './team-composer'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { DecisionGateRow } from '../../runtime/orchestration/types'

/**
 * Where a composed team lives between being proposed and being run.
 *
 * Split across two stores on purpose. The **roster** goes in the Feature Journal, because that is
 * the run's state and it has to survive the session (ARCHITECTURE, *state is on disk*). The
 * **verdict** stays on the gate row, because `decision_gates` is already the durable record of a
 * human decision and GP3 writes agreement against the same row — a second copy of "did they say
 * yes" would be a second answer to one question. A roster counts as approved only when both agree.
 */

/** Only the worktree fields the record needs: the disk to write, and whose disk it is. */
export type ComposedTeamWorktree = { path: string; hostId?: string | null }

/**
 * Writes the roster into the journal for the lead to read.
 *
 * Refuses a worktree on another execution host: `path` belongs to that host, so writing it here
 * would put the journal on the client's disk while the lead reads the host's. Never fatal — the
 * gate carries the roster in the question a human answers, so a journal that could not be written
 * costs the lead its brief, not the approval.
 */
export async function journalComposedTeam(input: {
  worktree: ComposedTeamWorktree | null
  runId: string
  objective: string
  team: ComposedTeam
  gateId: string
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
    const line = recordComposedTeam(journal, { ...input.team, gateId: input.gateId })
    appendJournalLog(journal, now().toISOString(), line)
    await writeJournal(path, journal)
    return true
  } catch (error) {
    console.warn('[alicorn] composed team not journalled', error)
    return false
  }
}

/**
 * The roster a human approved, or null.
 *
 * Both halves must agree: the journal names a gate, and that gate has to have been resolved with
 * the accept option. An unreadable journal, an unresolved gate or a resolution the human typed
 * themselves all read as no team — the lead then runs exactly as it did before AT1, which is the
 * only safe way to be wrong about this.
 */
export async function readApprovedTeam(input: {
  worktreePath: string
  runId: string
  getGate: (id: string) => DecisionGateRow | undefined | null
}): Promise<ComposedTeam | null> {
  let team: (ComposedTeam & { gateId: string }) | null = null
  try {
    team = (await readJournal(journalPath(input.worktreePath, input.runId)))?.team ?? null
  } catch {
    return null
  }
  if (!team) {
    return null
  }
  const gate = input.getGate(team.gateId)
  // `retired_at` set means the policy let the gate through instead of a human. `teamPropose` opens
  // this gate without `evaluate` so that cannot happen today; the check is here so that adding it
  // later cannot quietly turn "approved by a human" into "approved by a track record".
  if (!gate || gate.retired_at || !isTeamAccepted(gate.resolution)) {
    return null
  }
  const { gateId: _gateId, ...approved } = team
  return approved
}
