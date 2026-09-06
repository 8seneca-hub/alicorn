import type { OrchestrationDb } from '../runtime/orchestration/db'
import {
  ALICORN_CONTEXT_CEILING_TOKENS,
  type EscalationOffer
} from '../../shared/alicorn/context-ceiling'
import { contextTokensFromTranscriptTail, readTranscriptTail } from './transcript-context-tail'

// Why: a session that has not written for a few minutes is not the one filling this dispatch's
// window — matching on the worktree alone would read a neighbouring task's transcript.
const SESSION_ACTIVE_WINDOW_MS = 3 * 60 * 1000

type RecentTranscript = { sessionId: string; path: string; lastTimestamp: string }

type ClaudeUsageTranscriptSource = {
  getRecentSessionTranscriptsForWorktree: (
    worktreeId: string,
    sinceMs: number
  ) => RecentTranscript[]
}

export type ContextCeilingWatcherDeps = {
  getDb: () => OrchestrationDb | null
  claudeUsage: ClaudeUsageTranscriptSource | null
  publish: (offer: EscalationOffer) => void
  ceilingTokens?: number
  intervalMs?: number
  readTail?: typeof readTranscriptTail
  now?: () => number
}

type RunningDispatchRow = {
  dispatch_id: string
  task_id: string
  worktree_id: string | null
  start_options: string
}

// Why: tier 1 measures the ceiling for Claude Code only. Another backend gets no offer rather than
// a guess — an escalation we cannot substantiate is worse than none.
function isClaudeBackend(startOptions: string): boolean {
  try {
    const parsed = JSON.parse(startOptions) as { agent?: unknown }
    return parsed.agent === 'claude'
  } catch {
    return false
  }
}

export function startContextCeilingWatcher(deps: ContextCeilingWatcherDeps): {
  stop: () => void
  tickOnce: () => Promise<EscalationOffer[]>
} {
  const ceiling = deps.ceilingTokens ?? ALICORN_CONTEXT_CEILING_TOKENS
  const readTail = deps.readTail ?? readTranscriptTail
  const now = deps.now ?? Date.now
  let stopped = false

  async function contextTokensFor(worktreeId: string): Promise<number | null> {
    const transcripts = deps.claudeUsage!.getRecentSessionTranscriptsForWorktree(
      worktreeId,
      now() - SESSION_ACTIVE_WINDOW_MS
    )
    let highest: number | null = null
    for (const transcript of transcripts) {
      try {
        const tokens = contextTokensFromTranscriptTail(await readTail(transcript.path))
        if (tokens !== null && (highest === null || tokens > highest)) {
          highest = tokens
        }
      } catch {
        // Why: one unreadable transcript must not stop the watcher measuring every other task.
      }
    }
    return highest
  }

  async function tickOnce(): Promise<EscalationOffer[]> {
    const db = deps.getDb()
    if (!db || !deps.claudeUsage) {
      return []
    }
    const rows = db.db
      .prepare(
        `SELECT dc.id AS dispatch_id, dc.task_id, wd.worktree_id, wd.start_options
         FROM dispatch_contexts dc
         JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
         WHERE dc.status = 'dispatched'`
      )
      .all() as RunningDispatchRow[]

    const offers: EscalationOffer[] = []
    for (const row of rows) {
      if (!row.worktree_id || !isClaudeBackend(row.start_options)) {
        continue
      }
      const strategy = db.getTaskExecutionStrategy(row.task_id)
      // Already orchestrated, or already asked once — the offer is a one-shot, not a nag.
      if (strategy.strategy !== 'single' || strategy.escalationOfferedAt !== null) {
        continue
      }
      const contextTokens = await contextTokensFor(row.worktree_id)
      if (contextTokens === null || contextTokens < ceiling) {
        continue
      }
      // Why: markEscalationOffered is the guard, not a flag we set afterwards — it returns false if
      // another tick (or another window) got there first, so the offer is published exactly once.
      if (!db.markEscalationOffered(row.task_id)) {
        continue
      }
      const offer: EscalationOffer = {
        taskId: row.task_id,
        dispatchId: row.dispatch_id,
        paneKey: null,
        contextTokens
      }
      offers.push(offer)
      deps.publish(offer)
    }
    return offers
  }

  const intervalMs = deps.intervalMs ?? 60_000
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          if (!stopped) {
            void tickOnce().catch(() => {})
          }
        }, intervalMs)
      : null
  timer?.unref?.()

  return {
    stop: () => {
      stopped = true
      if (timer) {
        clearInterval(timer)
      }
    },
    tickOnce
  }
}
