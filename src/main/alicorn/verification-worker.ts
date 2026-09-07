import type { OrchestrationDb } from '../runtime/orchestration/db'
import { settleOutboxRow } from './outbox-row-processing'
import type { LedgerWriter } from './ledger/ledger-writer'
import { UNAVAILABLE_LOG_INTERVAL_MS, type StepVerificationPayload } from './ledger-outbox-drainer'

// Why 20 minutes: a project's own coverage/test command is admin-authored and can be
// slow; the row must eventually give up so a stuck project can't block the row forever.
export const VERIFICATION_ROW_TIMEOUT_MS = 20 * 60_000
const DEFAULT_INTERVAL_MS = 10_000

export type VerificationRunner = (
  payload: StepVerificationPayload,
  writer: LedgerWriter,
  options?: { signal?: AbortSignal }
) => Promise<void>

export type VerificationWorkerDeps = {
  getDb: () => OrchestrationDb | null
  writer: LedgerWriter | null
  verificationRunner: VerificationRunner | null
  intervalMs?: number
  rowTimeoutMs?: number
  now?: () => number
}

export type VerificationWorkerTickResult = {
  processed: number
  result: 'sent' | 'retry' | 'dead' | 'stop_pass' | 'idle'
}

export type VerificationWorker = {
  stop(): void
  tickOnce(): Promise<VerificationWorkerTickResult>
}

/**
 * Races the runner against `rowTimeoutMs` via `setTimeout` (not `AbortSignal.timeout`,
 * whose internal timer fake timers can't control) so a hung runner can't hold the row
 * forever; the runner still gets a real `AbortSignal` to forward to its own subprocess.
 */
function runWithRowTimeout(
  runner: VerificationRunner,
  payload: StepVerificationPayload,
  writer: LedgerWriter,
  rowTimeoutMs: number
): Promise<void> {
  const controller = new AbortController()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('verification_row_timeout'))
    }, rowTimeoutMs)
    try {
      runner(payload, writer, { signal: controller.signal }).then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    } catch (error) {
      // A synchronous throw (the only runner today is async, so unreachable in
      // practice) would otherwise skip both clearTimeout calls above and leave
      // this timer to abort a controller nobody is waiting on anymore.
      clearTimeout(timer)
      reject(error)
    }
  })
}

/**
 * Runs `step_verification` outbox rows one at a time, own timer and row-level timeout —
 * out of the drain loop so a slow project's coverage command can't queue every other
 * ledger write behind it (LG2a).
 */
export function startVerificationWorker(deps: VerificationWorkerDeps): VerificationWorker {
  let running = false
  // Set on 'stop_pass' (control plane unconfigured/unauthorized) so the row's own command
  // doesn't re-run every tick while auth stays broken — see the drainer's same-shaped stall.
  let pausedUntil = 0
  const now = deps.now ?? Date.now
  const rowTimeoutMs = deps.rowTimeoutMs ?? VERIFICATION_ROW_TIMEOUT_MS
  // Why no throttle window (unlike the drainer's throttledWarn): one row per tick, not
  // a batch, so a single slow/broken project can't spam the log the way 25 rows could.
  const warn = (message: string, detail: Record<string, unknown>): void =>
    console.warn(message, detail)
  const rowSettlementDeps = { now, warn, throttledWarn: warn }

  async function tickOnce(): Promise<VerificationWorkerTickResult> {
    if (running) {
      return { processed: 0, result: 'idle' }
    }
    if (now() < pausedUntil) {
      return { processed: 0, result: 'idle' }
    }
    const db = deps.getDb()
    const writer = deps.writer
    const verificationRunner = deps.verificationRunner
    if (!db || !writer || !verificationRunner) {
      return { processed: 0, result: 'idle' }
    }
    running = true
    try {
      const row = db.listDueLedgerOutbox(1, new Date(now()).toISOString(), {
        kinds: ['step_verification']
      })[0]
      if (!row) {
        return { processed: 0, result: 'idle' }
      }
      const payload = JSON.parse(row.payload) as StepVerificationPayload
      try {
        await runWithRowTimeout(verificationRunner, payload, writer, rowTimeoutMs)
        settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
        return { processed: 1, result: 'sent' }
      } catch (error) {
        const result = settleOutboxRow(db, row, { kind: 'failed', error }, rowSettlementDeps)
        if (result === 'stop_pass') {
          pausedUntil = now() + UNAVAILABLE_LOG_INTERVAL_MS
        }
        return { processed: 1, result }
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => {
    tickOnce().catch((error) => console.error('[verification-worker] tick failed:', error))
  }, deps.intervalMs ?? DEFAULT_INTERVAL_MS)

  return {
    stop() {
      clearInterval(timer)
    },
    tickOnce
  }
}
