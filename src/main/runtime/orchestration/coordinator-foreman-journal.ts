import {
  appendJournalLog,
  journalPath,
  openRunJournal,
  setJournalStatus,
  updateRunJournal,
  upsertPlanNode
} from '../../alicorn/foreman/journal-writer'
import type { Journal } from '../../alicorn/foreman/journal'
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

  async onTaskSettled(taskId: string, outcome: 'completed' | 'failed'): Promise<void> {
    const status: ForemanNodeStatus = outcome === 'completed' ? 'done' : 'failed'
    await this.mutate((journal) => {
      upsertPlanNode(journal, { id: taskId, status })
      appendJournalLog(journal, this.now().toISOString(), `node ${taskId} ${status}`)
    })
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

  private async mutate(change: (journal: Journal) => void): Promise<void> {
    const path = this.path
    if (!path) {
      return
    }
    await this.guard(() => updateRunJournal(path, change))
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
