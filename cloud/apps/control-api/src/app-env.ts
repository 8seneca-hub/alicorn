import type pg from 'pg'
import type { ControlApiConfig } from './config.js'
import type { ControlMetrics } from './control-metrics.js'

// Why: Task 4's auth middleware sets `c.set('auth', …)` against this typed env.
export type AuthContext = { tenantId: string; actor: string }
export type ControlApiEnv = { Variables: { auth: AuthContext } }

// Why: moved here from app.ts (R8) — route files importing ControlApiDeps from app.ts
// created a type-only import cycle back through app.ts's route registrations.
export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
  // Why: optional so existing test/prod deps still construct; app.ts defaults it.
  metrics?: ControlMetrics
}
