import {
  appendJournalLog,
  journalPath,
  openRunJournal,
  recordContractScan,
  recordDeclaredContracts,
  recordWaves,
  setJournalStatus,
  updateRunJournal,
  upsertPlanNode
} from '../../alicorn/foreman/journal-writer'
import { scanRepoContracts } from '../../alicorn/foreman/repo-contract-scan'
import {
  readJournal,
  relativeWavePath,
  wavePath,
  writeWaveTable,
  type Journal
} from '../../alicorn/foreman/journal'
import { holdsForFileOverlap, isWaveSettled } from '../../alicorn/foreman/wave-dependency-check'
import { reduceReports, renderWaveFile } from '../../alicorn/foreman/reduce-reports'
import { ForemanReportSchema, type ForemanReport } from '../../../shared/alicorn/foreman-report'
import type { ForemanNodeStatus } from '../../../shared/alicorn/foreman-run'
import type { OrchestrationDb } from './db'
import type { CoordinatorStatus, TaskRow } from './types'

const TITLE_MAX = 80

export type ForemanJournalDeps = {
  db: OrchestrationDb
  /** Absolute path of the worktree the run lives in; null leaves journalling inert. */
  worktreePath: string | null
  now?: () => Date
  onLog?: (message: string) => void
}

/**
 * The coordinator's half of the Feature Journal.
 *
 * Inert unless a task in the run is `orchestrated`. That keeps CLAUDE.md's rule that everything
 * works with Foreman absent literally true here: a `single` run writes no `.foreman/` at all, so
 * the default path gains no file, no directory and no write.
 */
export class CoordinatorForemanJournal {
  private readonly deps: ForemanJournalDeps
  private path: string | null = null
  private now: () => Date
  // Reports live here only between a node settling and its wave reducing. Nothing durable depends
  // on them: a restart mid-wave loses the wave's table, never the wave — the journal has the nodes.
  private readonly waveReports = new Map<string, ForemanReport>()
  private readonly announcedHolds = new Set<string>()

  constructor(deps: ForemanJournalDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
  }

  /** True once the run has been found orchestrated and a journal opened for it. */
  get isJournalling(): boolean {
    return this.path !== null
  }

  /**
   * Decides whether this run journals, and adopts an existing journal if one is on disk.
   *
   * Any orchestrated task makes the run orchestrated: a run with one decomposed stage still has a
   * lead, and that lead needs its journal.
   */
  async onRunStart(runId: string, objective: string): Promise<void> {
    if (!this.deps.worktreePath || !this.hasOrchestratedTask()) {
      return
    }
    const path = journalPath(this.deps.worktreePath, runId)
    await this.guard(async () => {
      const journal = await openRunJournal(path, {
        runId,
        objective,
        startedAt: this.now().toISOString()
      })
      this.path = path
      // Why seeded from the DAG and not left empty: the plan table is what the run view draws, and
      // a lead resuming mid-run should see the same nodes the coordinator is dispatching.
      await updateRunJournal(path, (current) => {
        for (const task of this.deps.db.listTasks()) {
          upsertPlanNode(current, {
            id: task.id,
            ...(nodeTitle(task) ? { title: nodeTitle(task) } : {}),
            dependsOn: taskDeps(task),
            status: nodeStatusFor(task.status)
          })
        }
        if (journal.log.length > 0) {
          appendJournalLog(current, this.now().toISOString(), `coordinator resumed run ${runId}`)
        }
        this.logNewOverlaps(current)
      })
    })
    await this.seedContractRegistry()
  }

  /**
   * Fills the Contract Registry from whatever schemas the worktree actually has.
   *
   * Once, at run start, before the first brief goes out — the registry only saves a worker the
   * 40k-token conversation if it is there when the brief is written. Guarded like every other
   * journal write: an unreadable worktree costs the record, never the run.
   */
  private async seedContractRegistry(): Promise<void> {
    const worktreePath = this.deps.worktreePath
    const path = this.path
    if (!worktreePath || !path) {
      return
    }
    await this.guard(async () => {
      const scan = await scanRepoContracts(worktreePath, { repo: '' })
      await updateRunJournal(path, (current) => {
        appendJournalLog(current, this.now().toISOString(), recordContractScan(current, scan))
      })
    })
  }

  async onDispatch(task: TaskRow, dispatchId: string, owner: string): Promise<void> {
    await this.mutate((journal) => {
      upsertPlanNode(journal, {
        id: task.id,
        ...(nodeTitle(task) ? { title: nodeTitle(task) } : {}),
        dependsOn: taskDeps(task),
        status: 'dispatched',
        dispatchId
      })
      // Owner is the lead's column, so it is filled only when the lead left it blank.
      const node = journal.plan.find((entry) => entry.id === task.id)
      if (node && !node.owner) {
        node.owner = owner
      }
      appendJournalLog(journal, this.now().toISOString(), `dispatched node ${task.id} to ${owner}`)
    })
  }

  async onTaskSettled(
    taskId: string,
    outcome: 'completed' | 'failed',
    reportBody?: string | null
  ): Promise<void> {
    const status: ForemanNodeStatus = outcome === 'completed' ? 'done' : 'failed'
    const report = parseReport(reportBody)
    if (report) {
      this.waveReports.set(taskId, report)
    }
    const journal = await this.mutate((current) => {
      upsertPlanNode(current, { id: taskId, status })
      appendJournalLog(current, this.now().toISOString(), `node ${taskId} ${status}`)
      // The agent-declared fallback: what the node says its interfaces are, marked as its word.
      const declared = report && recordDeclaredContracts(current, taskId, report)
      if (declared) {
        appendJournalLog(current, this.now().toISOString(), declared)
      }
    })
    if (journal) {
      await this.reduceSettledWave(journal, taskId)
    }
  }

  /**
   * Which of the ready tasks may go out now.
   *
   * Identity when this run is not journalled, which is what keeps CLAUDE.md's rule literal: a
   * `single` run's scheduler is not consulted about waves at all. It also fails open — a journal
   * that cannot be read costs the serialisation, never the run.
   */
  async admitReadyTasks(taskIds: readonly string[]): Promise<string[]> {
    const path = this.path
    if (!path || taskIds.length === 0) {
      return [...taskIds]
    }
    let journal: Journal | null = null
    await this.guard(async () => {
      journal = await readJournal(path)
    })
    if (!journal) {
      return [...taskIds]
    }
    const holds = holdsForFileOverlap((journal as Journal).plan, taskIds)
    for (const hold of holds) {
      const key = `${hold.nodeId}<-${hold.blockedBy}:${hold.path}`
      if (this.announcedHolds.has(key)) {
        continue
      }
      this.announcedHolds.add(key)
      this.deps.onLog?.(
        `Foreman: holding node ${hold.nodeId} — ${hold.path} is claimed by node ${hold.blockedBy}`
      )
    }
    const held = new Set(holds.map((hold) => hold.nodeId))
    return taskIds.filter((taskId) => !held.has(taskId))
  }

  /** An escalation is the run's own history, not a node's: it explains a re-plan later. */
  async onEscalation(subject: string, fromHandle: string): Promise<void> {
    await this.mutate((journal) => {
      appendJournalLog(
        journal,
        this.now().toISOString(),
        `escalation from ${fromHandle}: ${subject}`
      )
    })
  }

  async onRunEnd(status: CoordinatorStatus): Promise<void> {
    await this.mutate((journal) => {
      setJournalStatus(journal, status === 'completed' ? 'done' : 'failed')
      appendJournalLog(journal, this.now().toISOString(), `run ${status}`)
    })
  }

  private hasOrchestratedTask(): boolean {
    return this.deps.db
      .listTasks()
      .some((task) => this.deps.db.getTaskExecutionStrategy(task.id).strategy === 'orchestrated')
  }

  /** Waves are recomputed on every write, so an overlap surfaces as soon as the lead declares it. */
  private logNewOverlaps(journal: Journal): void {
    for (const overlap of recordWaves(journal)) {
      appendJournalLog(
        journal,
        this.now().toISOString(),
        `serialised on ${overlap.path}: nodes ${overlap.nodeIds.join(', ')} declare the same file`
      )
    }
  }

  /**
   * Folds a settled wave into `.foreman/<run>/wave-<n>.md` and points the journal at it.
   *
   * Once per wave: the lead reads one table instead of N reports, which is the whole reason a code
   * step runs here at all. A wave nobody reported on gets no file — an empty table would cost a
   * read and say nothing.
   */
  private async reduceSettledWave(journal: Journal, settledNodeId: string): Promise<void> {
    const worktreePath = this.deps.worktreePath
    const path = this.path
    const wave = journal.waves.find((entry) => entry.nodeIds.includes(settledNodeId))
    if (!worktreePath || !path || !wave || wave.reducedPath) {
      return
    }
    if (!isWaveSettled(journal.plan, wave.nodeIds)) {
      return
    }
    const entries = wave.nodeIds
      .map((nodeId) => ({ nodeId, report: this.waveReports.get(nodeId) }))
      .filter((entry): entry is { nodeId: string; report: ForemanReport } => !!entry.report)
    if (entries.length === 0) {
      return
    }

    const reduced = reduceReports(entries)
    const relative = relativeWavePath(journal.runId, wave.n)
    await this.guard(async () => {
      await writeWaveTable(
        wavePath(worktreePath, journal.runId, wave.n),
        renderWaveFile(wave.n, journal.runId, reduced)
      )
      await updateRunJournal(path, (current) => {
        const target = current.waves.find((entry) => entry.n === wave.n)
        if (target) {
          target.reducedPath = relative
        }
        appendJournalLog(
          current,
          this.now().toISOString(),
          `wave ${wave.n} reduced from ${entries.length} report(s) to ${relative}`
        )
      })
    })
    for (const nodeId of wave.nodeIds) {
      this.waveReports.delete(nodeId)
    }
  }

  private async mutate(change: (journal: Journal) => void): Promise<Journal | null> {
    const path = this.path
    if (!path) {
      return null
    }
    let updated: Journal | null = null
    await this.guard(async () => {
      updated = await updateRunJournal(path, (journal) => {
        change(journal)
        this.logNewOverlaps(journal)
      })
    })
    return updated
  }

  /**
   * A journal write never fails a run.
   *
   * The journal is how a run is understood afterwards, not how it executes; a full disk or a
   * read-only worktree must cost the record, not the work. The failure is logged so it is not
   * silent.
   */
  private async guard(write: () => Promise<unknown>): Promise<void> {
    try {
      await write()
    } catch (error) {
      this.deps.onLog?.(`Foreman journal write failed: ${String(error)}`)
    }
  }
}

function nodeTitle(task: TaskRow): string {
  const source = task.task_title ?? task.display_name ?? task.spec
  const firstLine = source.split('\n')[0]?.trim() ?? ''
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine
}

function taskDeps(task: TaskRow): string[] {
  try {
    const parsed: unknown = JSON.parse(task.deps)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

// The DAG's task vocabulary is wider than the journal's node vocabulary: `pending` and `ready` are
// both "not started", which is what the plan table's `pending` means.
function nodeStatusFor(status: TaskRow['status']): ForemanNodeStatus {
  switch (status) {
    case 'dispatched':
      return 'dispatched'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'blocked'
    case 'pending':
    case 'ready':
      return 'pending'
  }
}

/** A worker on a single-agent run sends free text; that is not a report, and is not an error here. */
function parseReport(body: string | null | undefined): ForemanReport | null {
  if (!body) {
    return null
  }
  try {
    const parsed = ForemanReportSchema.safeParse(JSON.parse(body) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
