import type { ForemanReport } from '../../../shared/alicorn/foreman-report'
import {
  clearContractGap,
  contractEntriesFromReport,
  emptyContractRegistry,
  mergeContractEntries,
  mergeContractGaps
} from './contract-registry'
import type { RepoContractScan } from './repo-contract-scan'
import {
  journalPath,
  readJournal,
  writeJournal,
  type Journal,
  type JournalNode,
  type JournalStatus,
  type JournalWaveOverlap
} from './journal'
import { planWaves } from './wave-dependency-check'
import type { JournalTeam } from './team-composer'

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
    waves: [],
    contractRegistry: emptyContractRegistry(),
    team: null,
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
  node: Partial<JournalNode> & { id: string }
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
      files: [],
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

/**
 * AT1: records the roster a gate is asking a human about, replacing any earlier proposal.
 *
 * Replacing rather than appending: a run has one team at a time, and keeping a superseded roster
 * next to the live one would leave the lead two answers to "who may I dispatch".
 */
export function recordComposedTeam(journal: Journal, team: JournalTeam): string {
  journal.team = team
  const filled = team.seats.filter((seat) => seat.memberId !== null).length
  return `team proposed at gate ${team.gateId}: ${filled}/${team.seats.length} seats filled${
    team.gaps.length > 0 ? `, ${team.gaps.length} gap(s)` : ''
  }`
}

function overlapKey(overlap: JournalWaveOverlap): string {
  return `${overlap.path}::${[...overlap.nodeIds].sort().join(',')}`
}

/**
 * Recomputes the wave plan from the nodes, and reports the overlaps that were not there before.
 *
 * Derived, never authored: the lead owns `dependsOn` and `files`, and the waves are what those two
 * columns imply. Recomputing on every write is what makes an overlap surface the moment the lead
 * declares the second node's files, rather than at the merge.
 *
 * `reducedPath` is carried across by wave number — it is the one thing on a wave that is a fact
 * about a run rather than a derivation, and recomputing must not throw it away.
 */
export function recordWaves(journal: Journal): JournalWaveOverlap[] {
  const known = new Set(journal.waves.flatMap((wave) => wave.overlaps.map(overlapKey)))
  const reducedByWave = new Map(journal.waves.map((wave) => [wave.n, wave.reducedPath]))

  journal.waves = planWaves(journal.plan).map((wave) => ({
    ...wave,
    reducedPath: reducedByWave.get(wave.n) ?? null
  }))

  const fresh = new Map<string, JournalWaveOverlap>()
  for (const overlap of journal.waves.flatMap((wave) => wave.overlaps)) {
    const key = overlapKey(overlap)
    if (!known.has(key) && !fresh.has(key)) {
      fresh.set(key, overlap)
    }
  }
  return [...fresh.values()]
}

function refusedSuffix(refused: number): string {
  return refused > 0 ? `; ${refused} refused at the registry ceiling` : ''
}

/**
 * Records a repo scan into the Contract Registry and returns the line to log.
 *
 * A scan that found nothing writes a gap rather than nothing at all: an empty registry reads as
 * "this repo has no interfaces", which is a claim the scan never made (`repo-contract-scan.ts`).
 * A scan that found something clears the repo's earlier gap, because the precondition is met.
 */
export function recordContractScan(journal: Journal, scan: RepoContractScan): string {
  const registry = journal.contractRegistry
  const merged = mergeContractEntries(registry, scan.entries)
  if (scan.entries.length > 0) {
    clearContractGap(registry, scan.repo)
  }
  mergeContractGaps(registry, scan.gaps)

  const where = scan.repo || 'the worktree'
  if (scan.entries.length === 0) {
    const gap = scan.gaps[0]
    return `contract registry: no schema extracted from ${where} — ${gap?.missing ?? 'nothing to extract'}; entries for it can only be agent-declared`
  }
  const documents = scan.sources.length
  return `contract registry: ${merged.added} interface(s) extracted from ${documents} document(s) in ${where}, ${merged.replaced} updated${refusedSuffix(merged.refused)}`
}

/**
 * Records a settled node's `interface_delta` as the agent-declared fallback.
 *
 * Marked as declared on the row, never silently merged with extracted rows: a model's assertion and
 * a schema's contents are different epistemic objects, and an extracted entry of the same name is
 * left standing rather than overwritten.
 */
export function recordDeclaredContracts(
  journal: Journal,
  nodeId: string,
  report: ForemanReport
): string | null {
  const entries = contractEntriesFromReport(nodeId, report)
  if (entries.length === 0) {
    return null
  }
  const merged = mergeContractEntries(journal.contractRegistry, entries)
  if (merged.added === 0 && merged.replaced === 0) {
    return null
  }
  return `contract registry: ${merged.added + merged.replaced} interface(s) agent-declared by node ${nodeId}${refusedSuffix(merged.refused)}`
}
