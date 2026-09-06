import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { ActiveOrRecentDispatchRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { RunCostByDispatch } from '../../shared/alicorn/run-cost'
import { backendFromWorkerStartOptions } from './step-outcome-builder'
import { parseSqliteUtc } from './run-usage-attribution'

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000
const ERROR_LOG_INTERVAL_MS = 5 * 60_000

type UsageStore = Pick<
  ClaudeUsageStore | CodexUsageStore,
  'getAutomationRunUsage' | 'getLastScanCompletedAt'
>

export type RunCostPublisherDeps = {
  getDb: () => OrchestrationDb | null
  claudeUsage: UsageStore | null
  codexUsage: UsageStore | null
  publish: (payload: RunCostByDispatch) => void
  intervalMs?: number
  now?: () => number
}

export type RunCostPublisher = {
  stop(): void
  tickOnce(): Promise<RunCostByDispatch>
}

// SQLite's own datetime('now') format: 'YYYY-MM-DD HH:MM:SS', no ms, no zone marker.
function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export function startRunCostPublisher(deps: RunCostPublisherDeps): RunCostPublisher {
  const now = deps.now ?? Date.now
  let lastPublishedJson: string | null = null
  let stopped = false
  let running = false
  let lastErrorLogAt = 0

  // Why throttled: a store that keeps throwing (e.g. a corrupt cache) must not
  // spam the log every tick — same idea as the drainer's logUnavailableOnce.
  function logDispatchErrorOnce(dispatchId: string, error: unknown): void {
    const nowMs = now()
    if (nowMs - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
      lastErrorLogAt = nowMs
      console.warn(`[alicorn-run-cost] cost lookup failed for dispatch ${dispatchId}:`, error)
    }
  }

  async function costForDispatch(
    row: ActiveOrRecentDispatchRow
  ): Promise<RunCostByDispatch[string]> {
    if (!row.worktreeId) {
      return { costUsd: null, status: 'pending' }
    }
    const backend = row.memberBackend ?? backendFromWorkerStartOptions(row.startOptions)
    const store =
      backend === 'claude' ? deps.claudeUsage : backend === 'codex' ? deps.codexUsage : null
    if (!store) {
      return { costUsd: null, status: 'unavailable' }
    }
    const nowMs = now()
    // Why bound to the row's own completedAt (not now): a dispatch settled long ago
    // must not have its window extended to now, which would sweep in later sessions.
    // Why min with lastScanCompletedAt: asking for usage past the store's own scan
    // freshness would force a rescan on our cadence instead of the scanner's own.
    const bound = parseSqliteUtc(row.completedAt) ?? nowMs
    const completedAt = Math.min(bound, store.getLastScanCompletedAt() ?? bound)
    const usage = await store.getAutomationRunUsage({
      worktreeId: row.worktreeId,
      terminalSessionId: null,
      startedAt: parseSqliteUtc(row.dispatchedAt),
      completedAt
    })
    if (usage.status === 'known') {
      return { costUsd: usage.estimatedCostUsd, status: 'known' }
    }
    return { costUsd: null, status: 'unavailable' }
  }

  async function tickOnce(): Promise<RunCostByDispatch> {
    const db = deps.getDb()
    if (!db) {
      return {}
    }
    const sinceUtc = toSqliteUtc(now() - RECENT_WINDOW_MS)
    const rows = db.listActiveOrRecentlyCompletedDispatches(sinceUtc)
    const payload: RunCostByDispatch = {}
    for (const row of rows) {
      try {
        payload[row.dispatchId] = await costForDispatch(row)
      } catch (error) {
        // Why isolated per-dispatch: one throwing store call must not blank the
        // whole tick's payload — every other dispatch's cost is still good data.
        payload[row.dispatchId] = { costUsd: null, status: 'unavailable' }
        logDispatchErrorOnce(row.dispatchId, error)
      }
    }
    const serialized = JSON.stringify(payload)
    if (serialized !== lastPublishedJson) {
      lastPublishedJson = serialized
      deps.publish(payload)
    }
    return payload
  }

  const intervalMs = deps.intervalMs ?? 60_000
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          // Why a running guard: a slow tick must not overlap the next scheduled one —
          // two concurrent ticks racing to set lastPublishedJson could publish stale data.
          if (stopped || running) {
            return
          }
          running = true
          void tickOnce()
            .catch(() => {})
            .finally(() => {
              running = false
            })
        }, intervalMs)
      : null
  timer?.unref?.()

  return {
    stop() {
      stopped = true
      if (timer) {
        clearInterval(timer)
      }
    },
    tickOnce
  }
}
