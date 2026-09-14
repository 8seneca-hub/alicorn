import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import { RequiredChecksSchema, type RequiredCheck } from '@alicorn-cloud/control-plane-contract'
import { unknownSkillCheckIds } from './skills-repository.js'

/**
 * What must pass for this project — and, when a stage is named, for that stage as well.
 *
 * Two authored sources, one answer. The project-level list is the floor every task clears; a stage
 * may require more (a review stage wanting diff coverage the spec stage has no use for). A stage's
 * checks were authored and stored from the first workflow and read by nothing, which made "0 checks"
 * on every row true and the pillar behind it — done is a set of machine-checkable gates — empty.
 *
 * The union, never a replacement: a stage cannot shed a check the project requires, which is the
 * same rule as a member not loosening its own criteria one indirection removed.
 */
export function getRequiredChecks(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  stageKey?: string
): Promise<RequiredCheck[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ checks: unknown }>(
      `SELECT checks FROM project_required_checks WHERE project_id = $1`,
      [projectId]
    )
    // Why: parse stored JSONB back through the schema so defaults (lcovPath, timeoutMs) are always present.
    const project = rows[0] ? RequiredChecksSchema.parse(rows[0].checks) : []
    if (!stageKey) return project
    // Across every workflow in the project: a stage key names the same step whichever pipeline runs
    // it, and reading one workflow would let the answer depend on which task asked.
    const staged = await client.query<{ required_checks: unknown }>(
      `SELECT s.required_checks FROM stages s
         JOIN workflows w ON w.id = s.workflow_id
        WHERE w.project_id = $1 AND s.key = $2`,
      [projectId, stageKey]
    )
    // Deduped structurally, not by kind: two `diff_coverage` checks at different thresholds are two
    // different questions and both belong, while the same check authored on the project and on the
    // stage is one requirement that must not be counted — or failed — twice. Both sides come
    // through the same schema, so the serialisation is comparable.
    const all = [...project]
    const seen = new Set(all.map((check) => JSON.stringify(check)))
    for (const row of staged.rows) {
      for (const check of RequiredChecksSchema.parse(row.required_checks)) {
        const identity = JSON.stringify(check)
        if (seen.has(identity)) continue
        seen.add(identity)
        all.push(check)
      }
    }
    return all
  })
}

export type PutChecksResult =
  | { kind: 'ok'; checks: RequiredCheck[] }
  | { kind: 'unknown_skill'; skillIds: string[] }

// OP2b: a `skill` check is validated against the catalog in the same transaction that stores it,
// so a skill deleted mid-call cannot leave behind a check that names nothing.
export function putRequiredChecks(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  updatedBy: string,
  checks: RequiredCheck[]
): Promise<PutChecksResult> {
  return withTenant(pool, tenantId, async (client) => {
    const unknown = await unknownSkillCheckIds(client, projectId, checks)
    if (unknown.length > 0) return { kind: 'unknown_skill', skillIds: unknown }
    const { rows } = await client.query<{ checks: unknown }>(
      `INSERT INTO project_required_checks (tenant_id, project_id, checks, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (tenant_id, project_id) DO UPDATE SET
         checks = EXCLUDED.checks,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING checks`,
      [tenantId, projectId, JSON.stringify(checks), updatedBy]
    )
    const row = rows[0]!
    return { kind: 'ok', checks: RequiredChecksSchema.parse(row.checks) }
  })
}
