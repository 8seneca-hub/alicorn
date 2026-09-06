import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  RequiredChecksSchema,
  type Stage,
  type TransitionInput,
  type Workflow,
  type WorkflowSummary,
  type WorkflowTemplate
} from '@alicorn-cloud/control-plane-contract'

// Why: the authored graph, without the identity a stored workflow carries.
export type WorkflowGraphInput = {
  projectId: string
  name: string
  stages: Stage[]
  transitions: TransitionInput[]
}

export type WriteResult =
  | { kind: 'ok'; workflow: Workflow }
  | { kind: 'not_found' }
  | { kind: 'version_conflict'; version: number }
  | { kind: 'unknown_member'; memberIds: string[] }

type WorkflowRow = {
  id: string
  tenant_id: string
  project_id: string
  name: string
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
}

type StageRow = {
  key: string
  name: string
  ordinal: number
  member_id: string | null
  reversibility: Stage['reversibility']
  inherited_cost: Stage['inheritedCost']
  required_checks: unknown
}

type TransitionRow = { from_key: string; to_key: string; trigger: TransitionInput['trigger'] }

function toStage(row: StageRow): Stage {
  return {
    key: row.key,
    name: row.name,
    ordinal: row.ordinal,
    memberId: row.member_id,
    reversibility: row.reversibility,
    inheritedCost: row.inherited_cost,
    // Why: parse stored JSONB back through the schema so check defaults are always present.
    requiredChecks: RequiredChecksSchema.parse(row.required_checks)
  }
}

async function readGraph(client: pg.PoolClient, row: WorkflowRow): Promise<Workflow> {
  const stages = await client.query<StageRow>(
    `SELECT key, name, ordinal, member_id, reversibility, inherited_cost, required_checks
     FROM stages WHERE workflow_id = $1 ORDER BY ordinal`,
    [row.id]
  )
  const transitions = await client.query<TransitionRow>(
    `SELECT f.key AS from_key, t.key AS to_key, tr.trigger
     FROM transitions tr
     JOIN stages f ON f.id = tr.from_stage
     JOIN stages t ON t.id = tr.to_stage
     WHERE tr.workflow_id = $1
     ORDER BY f.ordinal, t.ordinal`,
    [row.id]
  )
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    name: row.name,
    version: row.version,
    stages: stages.rows.map(toStage),
    transitions: transitions.rows.map((t) => ({ from: t.from_key, to: t.to_key, trigger: t.trigger })),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

// Why: a foreign key is checked as the system, so it would happily accept another tenant's member id.
// RLS applies to this SELECT, so anything missing here is outside the tenant.
async function unknownMemberIds(client: pg.PoolClient, stages: Stage[]): Promise<string[]> {
  const wanted = [...new Set(stages.map((s) => s.memberId).filter((id): id is string => id !== null))]
  if (wanted.length === 0) return []
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM members WHERE id = ANY($1::text[])`, [wanted])
  const found = new Set(rows.map((r) => r.id))
  return wanted.filter((id) => !found.has(id))
}

async function writeGraph(
  client: pg.PoolClient,
  tenantId: string,
  workflowId: string,
  input: WorkflowGraphInput
): Promise<void> {
  const values: string[] = []
  const params: unknown[] = []
  input.stages.forEach((stage, i) => {
    const p = i * 9
    values.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}::jsonb)`)
    params.push(
      tenantId,
      workflowId,
      stage.key,
      // Why: an unnamed stage displays as its key rather than as a blank row.
      stage.name === '' ? stage.key : stage.name,
      stage.ordinal,
      stage.memberId,
      stage.reversibility,
      stage.inheritedCost,
      JSON.stringify(stage.requiredChecks)
    )
  })
  await client.query(
    `INSERT INTO stages (tenant_id, workflow_id, key, name, ordinal, member_id, reversibility, inherited_cost, required_checks)
     VALUES ${values.join(', ')}
     ON CONFLICT (workflow_id, key) DO UPDATE SET
       name = EXCLUDED.name,
       ordinal = EXCLUDED.ordinal,
       member_id = EXCLUDED.member_id,
       reversibility = EXCLUDED.reversibility,
       inherited_cost = EXCLUDED.inherited_cost,
       required_checks = EXCLUDED.required_checks`,
    params
  )
  // Dropping a stage cascades its edges, so stale transitions cannot survive a rename.
  await client.query(`DELETE FROM stages WHERE workflow_id = $1 AND key <> ALL($2::text[])`, [
    workflowId,
    input.stages.map((s) => s.key)
  ])
  await client.query(`DELETE FROM transitions WHERE workflow_id = $1`, [workflowId])
  if (input.transitions.length === 0) return

  const { rows } = await client.query<{ id: string; key: string }>(
    `SELECT id, key FROM stages WHERE workflow_id = $1`,
    [workflowId]
  )
  const idByKey = new Map(rows.map((r) => [r.key, r.id]))
  const edgeValues: string[] = []
  const edgeParams: unknown[] = []
  input.transitions.forEach((transition, i) => {
    const p = i * 5
    edgeValues.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::jsonb)`)
    edgeParams.push(
      tenantId,
      workflowId,
      idByKey.get(transition.from),
      idByKey.get(transition.to),
      JSON.stringify(transition.trigger)
    )
  })
  await client.query(
    `INSERT INTO transitions (tenant_id, workflow_id, from_stage, to_stage, trigger) VALUES ${edgeValues.join(', ')}`,
    edgeParams
  )
}

export function listWorkflows(pool: pg.Pool, tenantId: string, projectId?: string): Promise<WorkflowSummary[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string
      project_id: string
      name: string
      version: number
      stage_count: string
      updated_at: Date
    }>(
      `SELECT w.id, w.project_id, w.name, w.version, w.updated_at, count(s.id) AS stage_count
       FROM workflows w
       LEFT JOIN stages s ON s.workflow_id = w.id
       WHERE ($1::text IS NULL OR w.project_id = $1)
       GROUP BY w.id
       ORDER BY w.project_id, w.name`,
      [projectId ?? null]
    )
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      version: row.version,
      stageCount: Number(row.stage_count),
      updatedAt: row.updated_at.toISOString()
    }))
  })
}

export function getWorkflow(pool: pg.Pool, tenantId: string, id: string): Promise<Workflow | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<WorkflowRow>(`SELECT * FROM workflows WHERE id = $1`, [id])
    const row = rows[0]
    if (!row) return null
    return readGraph(client, row)
  })
}

async function insertWorkflow(
  client: pg.PoolClient,
  tenantId: string,
  createdBy: string,
  input: WorkflowGraphInput
): Promise<WriteResult> {
  const unknown = await unknownMemberIds(client, input.stages)
  if (unknown.length > 0) return { kind: 'unknown_member', memberIds: unknown }
  const { rows } = await client.query<WorkflowRow>(
    `INSERT INTO workflows (tenant_id, project_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.projectId, input.name, createdBy]
  )
  const row = rows[0]!
  await writeGraph(client, tenantId, row.id, input)
  return { kind: 'ok', workflow: await readGraph(client, row) }
}

export function createWorkflow(
  pool: pg.Pool,
  tenantId: string,
  createdBy: string,
  input: WorkflowGraphInput
): Promise<WriteResult> {
  return withTenant(pool, tenantId, (client) => insertWorkflow(client, tenantId, createdBy, input))
}

/**
 * Binds a template's roles to this tenant's members and writes the result as an ordinary workflow.
 * Resolution and insert share one transaction, so a member added or deleted mid-call cannot produce
 * a graph that references someone who is not there. A role with no member leaves the stage
 * unassigned rather than failing — an unassigned stage is visible and fixable.
 */
export function createWorkflowFromTemplate(
  pool: pg.Pool,
  tenantId: string,
  createdBy: string,
  template: WorkflowTemplate,
  projectId: string,
  name?: string
): Promise<WriteResult> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; role: string }>(
      // Why: deterministic pick — the same template on the same tenant must always bind the same member.
      `SELECT DISTINCT ON (role) id, role FROM members ORDER BY role, name`
    )
    const memberIdByRole = new Map(rows.map((r) => [r.role, r.id]))
    return insertWorkflow(client, tenantId, createdBy, {
      projectId,
      name: name ?? template.name,
      stages: template.stages.map((stage) => ({
        key: stage.key,
        name: stage.name,
        ordinal: stage.ordinal,
        memberId: stage.memberRole ? (memberIdByRole.get(stage.memberRole) ?? null) : null,
        reversibility: stage.reversibility,
        inheritedCost: stage.inheritedCost,
        requiredChecks: []
      })),
      transitions: template.transitions.map((t) => ({ ...t }))
    })
  })
}

export function updateWorkflow(
  pool: pg.Pool,
  tenantId: string,
  id: string,
  expectedVersion: number,
  input: WorkflowGraphInput
): Promise<WriteResult> {
  return withTenant(pool, tenantId, async (client) => {
    // Why: FOR UPDATE inside the write transaction — two concurrent saves cannot both read
    // the same version and both win.
    const current = await client.query<{ version: number }>(
      `SELECT version FROM workflows WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const version = current.rows[0]?.version
    if (version === undefined) return { kind: 'not_found' }
    if (version !== expectedVersion) return { kind: 'version_conflict', version }

    const unknown = await unknownMemberIds(client, input.stages)
    if (unknown.length > 0) return { kind: 'unknown_member', memberIds: unknown }

    const { rows } = await client.query<WorkflowRow>(
      `UPDATE workflows SET project_id = $1, name = $2, version = version + 1, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [input.projectId, input.name, id]
    )
    const row = rows[0]!
    await writeGraph(client, tenantId, id, input)
    return { kind: 'ok', workflow: await readGraph(client, row) }
  })
}

export function deleteWorkflow(pool: pg.Pool, tenantId: string, id: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query(`DELETE FROM workflows WHERE id = $1`, [id])
    return (result.rowCount ?? 0) > 0
  })
}
