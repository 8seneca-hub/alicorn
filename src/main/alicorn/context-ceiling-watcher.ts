/**
 * The escalation watcher: D4's context ceiling, plus MR2's "this task touches more than one repo".
 *
 * MR2 reads the repos **declared** in the task's feature workspace (MR1's `alicorn_task_worktrees`,
 * via `countTaskRepos`), not repo roots inferred from a worker's `filesModified`. That report is
 * self-declared by the member, only exists once a step has settled, and carries no repo root —
 * recovering one would mean a `git rev-parse` per path, which a folder workspace has no answer to.
 * The tuple set is registry-backed, is true before the first token is spent, and is the one notion
 * of "which repos" MR1 landed; a second one would disagree with it eventually.
 */
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { ALICORN_CONTEXT_CEILING_TOKENS } from '../../shared/alicorn/context-ceiling'
import {
  evaluateEscalationSignal,
  type EscalationOffer
} from '../../shared/alicorn/escalation-offer'
import {
  contextUsageFromTranscriptTail,
  readTranscriptTail,
  type TranscriptContextUsage
} from './transcript-context-tail'
import { buildLeadCompactionPrompt } from './foreman/lead-compaction-prompt'
import { evaluateLeadContextCeiling } from './foreman/lead-context-ceiling'

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
  /**
   * Sends a lead its compaction prompt. Absent leaves the lead branch inert, which is how a
   * headless runtime with no terminals behaves.
   */
  sendPrompt?: (terminalHandle: string, prompt: string) => Promise<unknown>
  ceilingTokens?: number
  intervalMs?: number
  readTail?: typeof readTranscriptTail
  now?: () => number
}

type RunningDispatchRow = {
  dispatch_id: string
  task_id: string
  worktree_id: string | null
  agent_terminal_handle: string | null
  start_options: string
}

// Why: tier 1 measures the ceiling for Claude Code only. Another backend is not measured rather
// than guessed at — an escalation we cannot substantiate is worse than none. MR2's repo-span
// signal is backend-independent, so it is not behind this check.
function isClaudeBackend(startOptions: string): boolean {
  return readStartOptions(startOptions)?.agent === 'claude'
}

type StartOptions = { agent?: unknown; role?: unknown; launch?: unknown }

function readStartOptions(startOptions: string): StartOptions | null {
  try {
    return JSON.parse(startOptions) as StartOptions
  } catch {
    return null
  }
}

function isLeadDispatch(startOptions: string): boolean {
  return readStartOptions(startOptions)?.role === 'lead'
}

/**
 * The model chosen at launch, which is the only place the 1M-window variants are spelled — the
 * transcript records the API id, where `opus[1m]` and plain `opus` look the same.
 */
function launchModel(startOptions: string): string | null {
  const launch = readStartOptions(startOptions)?.launch as
    | { effective?: { model?: unknown }; requested?: { model?: unknown } }
    | undefined
  const model = launch?.effective?.model ?? launch?.requested?.model
  return typeof model === 'string' && model.trim() ? model : null
}

export function startContextCeilingWatcher(deps: ContextCeilingWatcherDeps): {
  stop: () => void
  tickOnce: () => Promise<EscalationOffer[]>
} {
  const ceiling = deps.ceilingTokens ?? ALICORN_CONTEXT_CEILING_TOKENS
  const readTail = deps.readTail ?? readTranscriptTail
  const now = deps.now ?? Date.now
  let stopped = false
  // Why in memory and not a column: this is "have I already said this to *this* live pane", which
  // dies with the pane. A dispatch re-armed by a restart simply gets told again, which is correct.
  const promptedLeads = new Set<string>()

  async function contextUsageFor(worktreeId: string): Promise<TranscriptContextUsage | null> {
    if (!deps.claudeUsage) {
      return null
    }
    const transcripts = deps.claudeUsage.getRecentSessionTranscriptsForWorktree(
      worktreeId,
      now() - SESSION_ACTIVE_WINDOW_MS
    )
    let highest: TranscriptContextUsage | null = null
    for (const transcript of transcripts) {
      try {
        const usage = contextUsageFromTranscriptTail(await readTail(transcript.path))
        if (usage && (highest === null || usage.contextTokens > highest.contextTokens)) {
          highest = usage
        }
      } catch {
        // Why: one unreadable transcript must not stop the watcher measuring every other task.
      }
    }
    return highest
  }

  /**
   * A lead is told to compact once per generation: after prompting we stay silent until the
   * measurement falls back under the ceiling, which is the evidence a compaction happened. A lead
   * that ignores the prompt is not nagged, and one that compacts is told again next time.
   */
  async function tickLead(row: RunningDispatchRow, usage: TranscriptContextUsage): Promise<void> {
    const verdict = evaluateLeadContextCeiling({
      contextTokens: usage.contextTokens,
      model: launchModel(row.start_options) ?? usage.model
    })
    if (!verdict?.atCeiling) {
      if (verdict) {
        promptedLeads.delete(row.dispatch_id)
      }
      return
    }
    if (promptedLeads.has(row.dispatch_id) || !row.agent_terminal_handle || !deps.sendPrompt) {
      return
    }
    promptedLeads.add(row.dispatch_id)
    try {
      await deps.sendPrompt(row.agent_terminal_handle, buildLeadCompactionPrompt(verdict))
    } catch {
      // Why re-arm: an undelivered prompt is not a prompt, and the lead is still over its ceiling.
      promptedLeads.delete(row.dispatch_id)
    }
  }

  async function tickOnce(): Promise<EscalationOffer[]> {
    const db = deps.getDb()
    // No claudeUsage guard here: MR2's repo-span signal is a COUNT over rows the desktop already
    // owns, so it works on a runtime that has never scanned a transcript.
    if (!db) {
      return []
    }
    const rows = db.db
      .prepare(
        `SELECT dc.id AS dispatch_id, dc.task_id, wd.worktree_id,
                wd.agent_terminal_handle, wd.start_options
         FROM dispatch_contexts dc
         JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
         WHERE dc.status = 'dispatched'`
      )
      .all() as RunningDispatchRow[]

    const offers: EscalationOffer[] = []
    for (const row of rows) {
      // A lead is already orchestrated, so it is never offered escalation — its ceiling is a
      // capacity limit answered by compaction, not a strategy change.
      if (isLeadDispatch(row.start_options)) {
        if (row.worktree_id && isClaudeBackend(row.start_options)) {
          const leadUsage = await contextUsageFor(row.worktree_id)
          if (leadUsage) {
            await tickLead(row, leadUsage)
          }
        }
        continue
      }
      const strategy = db.getTaskExecutionStrategy(row.task_id)
      // Already orchestrated, or already asked once — the offer is a one-shot, not a nag, and it
      // is one offer per *task*, so MR2's signal cannot raise a second toast after D4's.
      if (strategy.strategy !== 'single' || strategy.escalationOfferedAt !== null) {
        continue
      }
      const repoCount = db.countTaskRepos(row.task_id)
      // The ceiling costs a transcript read and only Claude Code can be measured, so it is only
      // reached when the free signal has not already decided — same precedence as the evaluator's.
      const contextTokens =
        repoCount > 1 || !row.worktree_id || !isClaudeBackend(row.start_options)
          ? null
          : ((await contextUsageFor(row.worktree_id))?.contextTokens ?? null)
      const decision = evaluateEscalationSignal({ repoCount, contextTokens, ceilingTokens: ceiling })
      if (!decision) {
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
        ...decision
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
