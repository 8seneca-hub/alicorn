import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import {
  runtimeGitRouteForTarget,
  type RuntimeGitTarget
} from '../../runtime/runtime-git-command-target'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { getLocalProjectWorktreeGitOptions } from '../../project-runtime-git-options'
import { parseSqliteUtc } from '../run-usage-attribution'
import {
  classifyCorrections,
  CORRECTION_WINDOW_MS,
  type DispatchSpan,
  type SettledStep
} from './corrections-watcher'
import { createGitHistoryReader, type CommitSummary } from './git-history-reader'
import { detectReopenedTasks } from './reopened-task-detector'

const DEFAULT_INTERVAL_MS = 600_000
const WORKTREE_ERROR_LOG_INTERVAL_MS = 5 * 60_000

// SQLite's own datetime('now') format: 'YYYY-MM-DD HH:MM:SS', no ms, no zone marker.
// Duplicated from run-cost-publisher.ts's private helper of the same name (one line).
function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export type CorrectionsSweepWorktree = {
  id: string
  path: string
  repoId: string
  hostId?: ExecutionHostId
}

export type CorrectionsSweepDeps = {
  getDb: () => OrchestrationDb
  runtime: { showManagedWorktree: (selector: string) => Promise<CorrectionsSweepWorktree> }
  store: Store | null
  intervalMs?: number
  now?: () => number
}

export type CorrectionsSweepSkip = {
  worktreeId: string
  reason: 'not_a_git_worktree' | 'unverifiable'
}

export type CorrectionsSweepTickResult = {
  scanned: number
  corrections: number
  skipped: CorrectionsSweepSkip[]
}

export type CorrectionsSweep = {
  stop(): void
  tickOnce(): Promise<CorrectionsSweepTickResult>
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// Why the duplicated two-line lookup (LC-R6): reuses D5's exact WSL resolution
// (base-ref-resolver.ts:27-45) without editing that file.
function localGitOptionsForRepo(store: Store | null, repoId: string): { wslDistro?: string } {
  const repo = store?.getRepos().find((candidate: Repo) => candidate.id === repoId)
  return repo ? getLocalProjectWorktreeGitOptions(store as Store, repo) : {}
}

type DispatchSpanRow = {
  task_id: string
  dispatched_at: string | null
  completed_at: string | null
}

function dispatchSpansForTasks(db: OrchestrationDb, taskIds: string[]): DispatchSpan[] {
  if (taskIds.length === 0) {
    return []
  }
  const placeholders = taskIds.map(() => '?').join(',')
  const rows = db.db
    .prepare(
      `SELECT task_id, dispatched_at, completed_at FROM dispatch_contexts WHERE task_id IN (${placeholders})`
    )
    .all(...taskIds) as DispatchSpanRow[]
  return rows
    .filter((row): row is DispatchSpanRow & { dispatched_at: string } => row.dispatched_at !== null)
    .map((row) => ({
      taskId: row.task_id,
      dispatchedAt: parseSqliteUtc(row.dispatched_at) ?? 0,
      completedAt: parseSqliteUtc(row.completed_at)
    }))
}

/** Periodic sweep (CW1): git corrections across worktrees, plus reopened-task detection (CW2). */
export function startCorrectionsSweep(deps: CorrectionsSweepDeps): CorrectionsSweep {
  let running = false
  let lastWorktreeErrorLogAt = 0

  // Why throttled: one bad worktree (a dropped SSH host, a corrupted repo) must not spam
  // the log every tick, and must never stop the other worktrees in the same sweep.
  function logWorktreeErrorThrottled(worktreeId: string, error: unknown): void {
    const now = Date.now()
    if (now - lastWorktreeErrorLogAt < WORKTREE_ERROR_LOG_INTERVAL_MS) {
      return
    }
    lastWorktreeErrorLogAt = now
    console.warn('[corrections-sweep] worktree scan failed', {
      worktreeId,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  async function tickOnce(): Promise<CorrectionsSweepTickResult> {
    const db = deps.getDb()
    const now = deps.now?.() ?? Date.now()
    const sinceUtc = toSqliteUtc(now - CORRECTION_WINDOW_MS)
    const result: CorrectionsSweepTickResult = { scanned: 0, corrections: 0, skipped: [] }

    const steps = db.listSettledDispatchesForCorrections(sinceUtc)
    const byWorktree = new Map<string, typeof steps>()
    for (const step of steps) {
      if (!step.worktreeId) {
        continue
      }
      const existing = byWorktree.get(step.worktreeId)
      if (existing) {
        existing.push(step)
      } else {
        byWorktree.set(step.worktreeId, [step])
      }
    }

    for (const [worktreeId, worktreeSteps] of byWorktree) {
      // LC-R2: an outcome id not yet posted by the drainer is retried next tick, not skipped.
      const resolvedSteps: SettledStep[] = []
      for (const step of worktreeSteps) {
        const outcomeId = db.getDispatchLedgerOutcome(step.dispatchId)
        const completedAtMs = parseSqliteUtc(step.completedAt)
        if (!outcomeId || completedAtMs === null) {
          continue
        }
        resolvedSteps.push({
          outcomeId,
          taskId: step.taskId,
          dispatchId: step.dispatchId,
          completedAt: completedAtMs,
          filesModified: step.filesModified
        })
      }
      if (resolvedSteps.length === 0) {
        continue
      }

      let worktree: CorrectionsSweepWorktree
      try {
        worktree = await deps.runtime.showManagedWorktree(`id:${worktreeId}`)
      } catch (error) {
        logWorktreeErrorThrottled(worktreeId, error)
        result.skipped.push({ worktreeId, reason: 'unverifiable' })
        continue
      }

      const localGitOptions = localGitOptionsForRepo(deps.store, worktree.repoId)
      let route: ReturnType<typeof runtimeGitRouteForTarget>
      try {
        route = runtimeGitRouteForTarget({
          executionHostId: worktree.hostId ?? LOCAL_EXECUTION_HOST_ID,
          localGitOptions
        } as RuntimeGitTarget)
      } catch (error) {
        logWorktreeErrorThrottled(worktreeId, error)
        result.skipped.push({ worktreeId, reason: 'unverifiable' })
        continue
      }

      let exec: (argv: string[]) => Promise<{ stdout: string }>
      if (route.kind === 'ssh') {
        // provider: null means "remote and currently unreachable" -- never "run it here".
        if (!route.provider) {
          result.skipped.push({ worktreeId, reason: 'unverifiable' })
          continue
        }
        const provider = route.provider
        exec = (argv) => provider.exec(argv, worktree.path)
        // Trust the SSH provider for repo-ness; no local filesystem check on a remote path.
      } else {
        if (!(await pathExists(join(worktree.path, '.git')))) {
          result.skipped.push({ worktreeId, reason: 'not_a_git_worktree' })
          continue
        }
        exec = (argv) =>
          gitExecFileAsync(argv, {
            cwd: worktree.path,
            admissionTier: 'interactive',
            ...localGitOptions
          })
      }

      const earliestCompletedAt = Math.min(...resolvedSteps.map((step) => step.completedAt))
      const sinceForWorktree = new Date(earliestCompletedAt - 60_000).toISOString()

      let commits: CommitSummary[]
      try {
        commits = await createGitHistoryReader(exec).commitsSince(sinceForWorktree)
      } catch (error) {
        logWorktreeErrorThrottled(worktreeId, error)
        continue
      }

      const taskIds = [...new Set(resolvedSteps.map((step) => step.taskId))]
      const spans = dispatchSpansForTasks(db, taskIds)
      const corrections = classifyCorrections(resolvedSteps, commits, spans, now)
      for (const correction of corrections) {
        const enqueued = db.enqueueLedgerOutbox({
          kind: 'human_verdict_patch',
          dedupeKey: `human_verdict_patch:${correction.outcomeId}`,
          payload: {
            outcomeId: correction.outcomeId,
            humanVerdict: correction.verdict,
            amendedAfterMs: correction.amendedAfterMs,
            source: correction.source
          }
        })
        if (!enqueued.duplicate) {
          result.corrections += 1
        }
      }

      db.setCorrectionScan(worktreeId, toSqliteUtc(now), commits[0]?.sha ?? null)
      result.scanned += 1
    }

    for (const reopened of detectReopenedTasks(db, sinceUtc)) {
      const outcomeId = db.getDispatchLedgerOutcome(reopened.priorDispatchId)
      if (!outcomeId) {
        continue
      }
      const newDispatchedAtMs = parseSqliteUtc(reopened.newDispatchedAt)
      const priorCompletedAtMs = parseSqliteUtc(reopened.priorCompletedAt)
      if (newDispatchedAtMs === null || priorCompletedAtMs === null) {
        continue
      }
      const enqueued = db.enqueueLedgerOutbox({
        kind: 'human_verdict_patch',
        dedupeKey: `human_verdict_patch:${outcomeId}`,
        payload: {
          outcomeId,
          humanVerdict: 'amended',
          amendedAfterMs: newDispatchedAtMs - priorCompletedAtMs,
          source: 'reopened_task'
        }
      })
      if (!enqueued.duplicate) {
        result.corrections += 1
      }
    }

    return result
  }

  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  const timer = setInterval(() => {
    if (running) {
      return
    }
    running = true
    tickOnce()
      .catch((error) => console.error('[corrections-sweep] tick failed:', error))
      .finally(() => {
        running = false
      })
  }, intervalMs)

  return {
    stop() {
      clearInterval(timer)
    },
    tickOnce
  }
}
