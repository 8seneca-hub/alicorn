import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  StageConfigSchema,
  defaultStageConfig,
  type StageConfig
} from '@alicorn-cloud/control-plane-contract'

type StageConfigRow = { reversibility: string; inherited_cost: string }

/**
 * `reversibility` and `inherited_cost` are authored, never inferred (ARCHITECTURE §7). An absent
 * row falls back to the seeded default — `merge` and `deploy` are irreversible and high inherited
 * cost, everything else contained and low — which is a stated default, not a guess about the step.
 */
export function getStageConfig(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  stageKey: string
): Promise<StageConfig> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<StageConfigRow>(
      `SELECT reversibility, inherited_cost FROM project_stage_config
       WHERE project_id = $1 AND stage_key = $2`,
      [projectId, stageKey]
    )
    const row = rows[0]
    if (!row) return defaultStageConfig(stageKey)
    return StageConfigSchema.parse({
      reversibility: row.reversibility,
      inheritedCost: row.inherited_cost
    })
  })
}

export function putStageConfig(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  stageKey: string,
  updatedBy: string,
  config: StageConfig
): Promise<StageConfig> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<StageConfigRow>(
      `INSERT INTO project_stage_config
         (tenant_id, project_id, stage_key, reversibility, inherited_cost, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id, project_id, stage_key) DO UPDATE SET
         reversibility = EXCLUDED.reversibility,
         inherited_cost = EXCLUDED.inherited_cost,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING reversibility, inherited_cost`,
      [tenantId, projectId, stageKey, config.reversibility, config.inheritedCost, updatedBy]
    )
    const row = rows[0]!
    return StageConfigSchema.parse({
      reversibility: row.reversibility,
      inheritedCost: row.inherited_cost
    })
  })
}
