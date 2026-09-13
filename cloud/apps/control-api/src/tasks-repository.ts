import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  TASK_DONE_COLUMN,
  type Task,
  type TaskInput,
  type TaskPatch,
  type TaskSource
} from '@alicorn-cloud/control-plane-contract'

type TaskRow = {
  id: string
  tenant_id: string
  project_id: string
  number: number
  title: string
  context: string
  column_id: string
  execution_strategy: 'single' | 'orchestrated'
  workflow_id: string | null
  stage_key: string | null
  model: string | null
  source_provider: TaskSource['provider'] | null
  source_ref: string | null
  source_url: string | null
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  closed_at: Date | string | null
  member_ids: string[] | null
}

const SELECT_TASKS = `
  SELECT t.id, t.tenant_id, t.project_id, t.number, t.title, t.context, t.column_id,
         t.execution_strategy, t.workflow_id, t.stage_key, t.model,
         t.source_provider, t.source_ref, t.source_url,
         t.created_by, t.created_at, t.updated_at, t.closed_at,
         COALESCE(array_agg(m.member_id ORDER BY m.member_id) FILTER (WHERE m.member_id IS NOT NULL), '{}') AS member_ids
  FROM tasks t
  LEFT JOIN task_members m ON m.task_id = t.id`

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    context: row.context,
    column: row.column_id,
    executionStrategy: row.execution_strategy,
    workflowId: row.workflow_id,
    stageKey: row.stage_key,
    model: row.model,
    memberIds: row.member_ids ?? [],
    source:
      row.source_provider && row.source_ref
        ? { provider: row.source_provider, ref: row.source_ref, url: row.source_url }
        : null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null
  }
}

function readOne(client: pg.PoolClient, taskId: string): Promise<Task | null> {
  return client
    .query<TaskRow>(`${SELECT_TASKS} WHERE t.id = $1 GROUP BY t.id`, [taskId])
    .then(({ rows }) => (rows[0] ? toTask(rows[0]) : null))
}

async function setMembers(
  client: pg.PoolClient,
  tenantId: string,
  taskId: string,
  memberIds: readonly string[]
): Promise<void> {
  await client.query(`DELETE FROM task_members WHERE task_id = $1`, [taskId])
  if (memberIds.length === 0) return
  await client.query(
    `INSERT INTO task_members (tenant_id, task_id, member_id)
     SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
    [tenantId, taskId, [...new Set(memberIds)]]
  )
}

export function listTasks(pool: pg.Pool, tenantId: string, projectId: string): Promise<Task[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<TaskRow>(
      `${SELECT_TASKS} WHERE t.project_id = $1 GROUP BY t.id ORDER BY t.number DESC`,
      [projectId]
    )
    return rows.map(toTask)
  })
}

export function getTask(pool: pg.Pool, tenantId: string, taskId: string): Promise<Task | null> {
  return withTenant(pool, tenantId, (client) => readOne(client, taskId))
}

/**
 * The number is taken inside the same transaction as the insert, so two creates cannot read the
 * same MAX. If they somehow do, the unique index on (tenant_id, project_id, number) rejects the
 * second — the route treats that as retryable rather than handing back a duplicate id.
 */
export function createTask(
  pool: pg.Pool,
  tenantId: string,
  createdBy: string,
  input: TaskInput
): Promise<Task | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows: project } = await client.query<{ id: string }>(
      `SELECT id FROM projects WHERE id = $1`,
      [input.projectId]
    )
    if (!project[0]) return null
    // Importing a board twice is a normal thing to do — the second run answers with the ticket the
    // first one made rather than a duplicate or an error, so an importer can count it as skipped.
    // The unique index behind this is the race backstop, not the check.
    if (input.source) {
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM tasks
         WHERE project_id = $1 AND source_provider = $2 AND source_ref = $3`,
        [input.projectId, input.source.provider, input.source.ref]
      )
      if (existing[0]) {
        return readOne(client, existing[0].id)
      }
    }
    const { rows } = await client.query<{ id: string }>(
      // closed_at is stamped here too, not only on the patch: a task filed straight into the done
      // column is finished, and two paths that disagree make "when did this close" unanswerable.
      `INSERT INTO tasks (tenant_id, project_id, number, title, context, column_id,
                          execution_strategy, workflow_id, stage_key, model, created_by, closed_at,
                          source_provider, source_ref, source_url)
       VALUES ($1, $2,
               (SELECT COALESCE(MAX(number), 0) + 1 FROM tasks WHERE project_id = $2),
               $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $5 = $11 THEN now() ELSE NULL END,
               $12, $13, $14)
       RETURNING id`,
      [
        tenantId,
        input.projectId,
        input.title,
        input.context,
        input.column,
        input.executionStrategy,
        input.workflowId,
        input.stageKey,
        input.model,
        createdBy,
        TASK_DONE_COLUMN,
        input.source?.provider ?? null,
        input.source?.ref ?? null,
        input.source?.url ?? null
      ]
    )
    const id = rows[0]!.id
    await setMembers(client, tenantId, id, input.memberIds)
    return readOne(client, id)
  })
}

/**
 * A patch, not a replace: the board moves a column and the composer edits a title, and neither
 * should have to send back fields it never read. `closed_at` follows the column rather than being
 * set by a caller — "done" is one fact, and two ways to say it drift.
 */
export function updateTask(
  pool: pg.Pool,
  tenantId: string,
  taskId: string,
  patch: TaskPatch
): Promise<Task | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tasks SET
         title = COALESCE($2, title),
         context = COALESCE($3, context),
         column_id = COALESCE($4, column_id),
         execution_strategy = COALESCE($5, execution_strategy),
         stage_key = CASE WHEN $6::boolean THEN $7 ELSE stage_key END,
         workflow_id = CASE WHEN $9::boolean THEN $10 ELSE workflow_id END,
         model = CASE WHEN $11::boolean THEN $12 ELSE model END,
         closed_at = CASE
           WHEN $4::text IS NULL THEN closed_at
           WHEN $4::text = $8::text THEN COALESCE(closed_at, now())
           ELSE NULL
         END,
         updated_at = now()
       WHERE id = $1`,
      [
        taskId,
        patch.title ?? null,
        patch.context ?? null,
        patch.column ?? null,
        patch.executionStrategy ?? null,
        Object.hasOwn(patch, 'stageKey'),
        patch.stageKey ?? null,
        TASK_DONE_COLUMN,
        Object.hasOwn(patch, 'workflowId'),
        patch.workflowId ?? null,
        Object.hasOwn(patch, 'model'),
        patch.model ?? null
      ]
    )
    if (rowCount === 0) return null
    if (patch.memberIds) {
      await setMembers(client, tenantId, taskId, patch.memberIds)
    }
    return readOne(client, taskId)
  })
}

export function deleteTask(pool: pg.Pool, tenantId: string, taskId: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`DELETE FROM tasks WHERE id = $1`, [taskId])
    return (rowCount ?? 0) > 0
  })
}
