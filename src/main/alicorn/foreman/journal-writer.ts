import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { TaskRow, TaskStatus } from '../../runtime/orchestration/types'
import { journalPath, readJournal, writeJournal } from './journal'
import type { Journal, JournalNode, JournalNodeStatus } from './journal-types'

const NODE_STATUS_BY_TASK: Record<TaskStatus, JournalNodeStatus> = {
  pending: 'pending',
  ready: 'pending',
  dispatched: 'dispatched',
  completed: 'done',
  failed: 'failed',
  blocked: 'blocked'
}

const TITLE_MAX = 120

function nodeFor(db: OrchestrationDb, task: TaskRow): JournalNode {
  const latest = db.getDispatchContext(task.id)
  return {
    id: task.id,
    title: (task.task_title ?? task.spec).slice(0, TITLE_MAX),
    owner: task.display_name ?? latest?.assignee_handle ?? '',
    dependsOn: parseDeps(task.deps),
    status: NODE_STATUS_BY_TASK[task.status] ?? 'pending',
    model: null,
    dispatchId: latest?.id ?? null
  }
}

function parseDeps(deps: string): string[] {
  try {
    const parsed = JSON.parse(deps) as unknown
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

export type JournalRecorderDeps = {
  db: OrchestrationDb
  runId: string
  worktreePath: string
  objective: string
  onLog?: (message: string) => void
  now?: () => Date
}

/**
 * Keeps the Feature Journal in step with an orchestrated run.
 *
 * Every method is fire-and-forget and serialised through one chain: the coordinator loop must not
 * wait on a file write, and two events in the same tick must not interleave two read-modify-writes
 * of the same file. A journal failure is logged and dropped — losing the record of a run is bad,
 * but killing the run to protect the record is worse.
 */
export class ForemanJournalRecorder {
  private deps: JournalRecorderDeps
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: JournalRecorderDeps) {
    this.deps = deps
  }

  private get path(): string {
    return journalPath(this.deps.worktreePath, this.deps.runId)
  }

  private log(message: string): void {
    this.deps.onLog?.(message)
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  // Why check every time rather than once: decompose can add tasks after the run starts, so a run
  // can become orchestrated later. A run with no orchestrated task never gets a `.foreman/`.
  private isOrchestrated(): boolean {
    return this.deps.db
      .listTasks()
      .some((task) => this.deps.db.getTaskExecutionStrategy(task.id).strategy === 'orchestrated')
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      this.log(`Foreman journal write failed: ${String(error)}`)
    })
  }

  /** Resolves once every queued write has settled; tests and shutdown wait on it. */
  async settled(): Promise<void> {
    await this.queue
  }

  private async currentJournal(): Promise<Journal> {
    const existing = await readJournal(this.path)
    return (
      existing ?? {
        runId: this.deps.runId,
        objective: this.deps.objective,
        status: 'running',
        startedAt: this.timestamp(),
        budgetCents: null,
        spentCents: null,
        decisions: [],
        assumptions: [],
        plan: [],
        contractRegistry: '',
        log: [],
        notDone: []
      }
    )
  }

  // The plan table is rebuilt from the tasks each time rather than patched, so the journal cannot
  // drift from the run it describes. Decisions, assumptions and the registry are the lead's and are
  // never rewritten here.
  private async sync(line: string | null): Promise<void> {
    if (!this.isOrchestrated()) {
      return
    }
    const journal = await this.currentJournal()
    journal.plan = this.deps.db.listTasks().map((task) => nodeFor(this.deps.db, task))
    if (line) {
      journal.log = [...journal.log, { at: this.timestamp(), line }]
    }
    await writeJournal(this.path, journal)
  }

  runStarted(): void {
    this.enqueue(() => this.sync('run started'))
  }

  nodeDispatched(taskId: string, handle: string): void {
    this.enqueue(() => this.sync(`node ${taskId} dispatched to ${handle}`))
  }

  nodeSettled(taskId: string, outcome: 'completed' | 'failed'): void {
    this.enqueue(() => this.sync(`node ${taskId} ${outcome}`))
  }

  escalated(from: string, subject: string): void {
    this.enqueue(() => this.sync(`escalation from ${from}: ${subject}`))
  }

  runFinished(status: 'done' | 'failed'): void {
    this.enqueue(async () => {
      if (!this.isOrchestrated()) {
        return
      }
      const journal = await this.currentJournal()
      journal.plan = this.deps.db.listTasks().map((task) => nodeFor(this.deps.db, task))
      journal.status = status
      journal.log = [...journal.log, { at: this.timestamp(), line: `run ${status}` }]
      await writeJournal(this.path, journal)
    })
  }
}
