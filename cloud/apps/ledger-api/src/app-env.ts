import type pg from 'pg'
import type { ControlPlaneAuthEnv } from '@alicorn-cloud/control-plane-auth'
import type { LedgerApiConfig } from './config.js'
import type { LedgerMetrics } from './ledger-metrics.js'

export type { AuthContext } from '@alicorn-cloud/control-plane-auth'
export type LedgerApiEnv = ControlPlaneAuthEnv

// Why: moved here from app.ts (R8) — route files importing LedgerApiDeps from app.ts
// created a type-only import cycle back through app.ts's route registrations.
export type LedgerApiDeps = {
  config: LedgerApiConfig
  pool: pg.Pool
  now?: () => number
  // Why: optional so existing test/prod deps still construct; app.ts defaults it.
  metrics?: LedgerMetrics
}
