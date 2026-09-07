import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'

// Why: intended as an operator-wide gauge (LC brief), but step_outcomes has FORCE ROW LEVEL SECURITY
// and the pool role owns the table without BYPASSRLS — Postgres refuses `row_security = off` for a
// FORCE'd table even for the owner (42501, "use ALTER TABLE NO FORCE ROW LEVEL SECURITY"), so a plain
// pool query always sees zero rows. Until a BYPASSRLS/superuser operator role exists (infra work, out
// of this task's scope), scope to the deployment's one configured tenant — correct today since tier-1
// runs a single constant tenant; flagged for the controller to decide on a real operator role later.
export async function countAmendedWithinWindow(pool: pg.Pool, tenantId: string): Promise<number> {
  const { rows } = await withTenant(pool, tenantId, (client) =>
    client.query<{ count: string }>(
      `SELECT count(*) FROM step_outcomes WHERE human_verdict = 'amended' AND created_at > now() - interval '7 days'`
    )
  )
  return Number(rows[0]?.count ?? 0)
}

const AMENDED_WITHIN_WINDOW_CACHE_MS = 30_000
let lastAmendedRefreshAt = 0

// Why cached and swallowed: /metrics is scraped far more often than this gauge needs to move,
// and a pool error here must not take the whole endpoint down -- it keeps the last known value.
export async function refreshAmendedWithinWindow(
  metrics: LedgerMetrics,
  pool: pg.Pool,
  tenantId: string,
  now: () => number = Date.now
): Promise<void> {
  const nowMs = now()
  if (nowMs - lastAmendedRefreshAt < AMENDED_WITHIN_WINDOW_CACHE_MS) {
    return
  }
  lastAmendedRefreshAt = nowMs
  try {
    metrics.setAmendedWithinWindow(await countAmendedWithinWindow(pool, tenantId))
  } catch (error) {
    console.warn(
      '[alicorn-ledger-api] amended_within_window refresh failed, keeping last value',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function _resetAmendedWithinWindowCacheForTests(): void {
  lastAmendedRefreshAt = 0
}

// Why: plain in-memory Prometheus counters — no prom-client dependency (tier-1 binding rule).
export class LedgerMetrics {
  private ledgerWriteDuplicates = 0
  private readonly gateDecisions = new Map<string, { decision: string; reason: string; count: number }>()
  private amendedWithinWindow = 0

  incLedgerWriteDuplicate(): void {
    this.ledgerWriteDuplicates++
  }

  incGateDecision(decision: string, reason: string): void {
    const key = JSON.stringify([decision, reason])
    const existing = this.gateDecisions.get(key)
    this.gateDecisions.set(key, { decision, reason, count: (existing?.count ?? 0) + 1 })
  }

  setAmendedWithinWindow(n: number): void {
    this.amendedWithinWindow = n
  }

  renderPrometheus(): string {
    const lines = [
      '# TYPE ledger_write_duplicates_total counter',
      `ledger_write_duplicates_total ${this.ledgerWriteDuplicates}`,
      '# TYPE gate_decisions_total counter'
    ]
    for (const { decision, reason, count } of this.gateDecisions.values()) {
      lines.push(`gate_decisions_total{decision="${escapeLabel(decision)}",reason="${escapeLabel(reason)}"} ${count}`)
    }
    lines.push('# TYPE amended_within_window gauge', `amended_within_window ${this.amendedWithinWindow}`)
    return lines.join('\n') + '\n'
  }
}

export function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}
