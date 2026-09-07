import type pg from 'pg'
import type { ControlPlaneAuthEnv } from '@alicorn-cloud/control-plane-auth'
import type { ControlApiConfig } from './config.js'
import type { ControlMetrics } from './control-metrics.js'

export type { AuthContext } from '@alicorn-cloud/control-plane-auth'
export type ControlApiEnv = ControlPlaneAuthEnv

// Why: moved here from app.ts (R8) — route files importing ControlApiDeps from app.ts
// created a type-only import cycle back through app.ts's route registrations.
export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
  // Why: optional so existing test/prod deps still construct; app.ts defaults it.
  metrics?: ControlMetrics
}
