import type pg from 'pg'
import type { LedgerApiConfig } from './config.js'
import type { LedgerMetrics } from './ledger-metrics.js'

// Why: Task 8's auth middleware sets `c.set('auth', …)` against this typed env.
export type AuthContext = { tenantId: string; actor: string }
export type LedgerApiEnv = { Variables: { auth: AuthContext } }

// Why: moved here from app.ts (R8) — route files importing LedgerApiDeps from app.ts
// created a type-only import cycle back through app.ts's route registrations.
export type LedgerApiDeps = {
  config: LedgerApiConfig
  pool: pg.Pool
  now?: () => number
  // Why: optional so existing test/prod deps still construct; app.ts defaults it.
  metrics?: LedgerMetrics
}
