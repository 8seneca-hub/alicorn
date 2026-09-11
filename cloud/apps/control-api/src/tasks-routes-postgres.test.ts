import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool,
  withTenant
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import type { Project, Task } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_tasks_test'

describePostgres('tasks routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let project: Project

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy',
    'content-type': 'application/json'
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema,
      applicationName: 'control-api-tasks-test'
    })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  beforeEach(async () => {
    await withTenant(pool, 'local', async (client) => {
      await client.query('DELETE FROM projects')
    })
    const response = await app.request('/v1/projects', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Payments Platform', key: 'PAY', repoIds: ['repo-a'] })
    })
    project = ((await response.json()) as { project: Project }).project
  })

  async function createTask(body: Record<string, unknown>): Promise<Response> {
    return app.request('/v1/tasks', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ projectId: project.id, ...body })
    })
  }

  async function taskOf(response: Response): Promise<Task> {
    return ((await response.json()) as { task: Task }).task
  }

  it('numbers tasks per project so the id reads as PAY-1, PAY-2', async () => {
    const first = await taskOf(await createTask({ title: 'Refund API' }))
    const second = await taskOf(await createTask({ title: 'Webhook retries' }))

    expect(first.number).toBe(1)
    expect(second.number).toBe(2)
    expect(first.projectId).toBe(project.id)
  })

  it('restarts numbering in a second project rather than sharing a sequence', async () => {
    await createTask({ title: 'Refund API' })
    const other = await app.request('/v1/projects', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Ledger', key: 'LED', repoIds: ['repo-ledger'] })
    })
    const otherProject = ((await other.json()) as { project: Project }).project

    const response = await app.request('/v1/tasks', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ projectId: otherProject.id, title: 'Close the books' })
    })

    expect((await taskOf(response)).number).toBe(1)
  })

  it('defaults to single and the todo column — never orchestrated', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API' }))

    expect(task.executionStrategy).toBe('single')
    expect(task.column).toBe('todo')
    expect(task.stageKey).toBeNull()
    expect(task.memberIds).toEqual([])
    expect(task.closedAt).toBeNull()
  })

  it('lists a project’s tasks newest first, and only that project’s', async () => {
    await createTask({ title: 'Refund API' })
    await createTask({ title: 'Webhook retries' })

    const response = await app.request(`/v1/projects/${project.id}/tasks`, {
      headers: authHeaders
    })
    const { tasks } = (await response.json()) as { tasks: Task[] }

    expect(tasks.map((task) => task.title)).toEqual(['Webhook retries', 'Refund API'])
  })

  // The compatibility read path every other project-scoped route already has.
  it('reads a board by a repository id bound to the project', async () => {
    await createTask({ title: 'Refund API' })

    const response = await app.request('/v1/projects/repo-a/tasks', { headers: authHeaders })
    const { tasks } = (await response.json()) as { tasks: Task[] }

    expect(tasks).toHaveLength(1)
  })

  it('patches one field without being sent the rest', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API', context: 'partial amounts' }))

    const response = await app.request(`/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ column: 'in-progress' })
    })
    const moved = await taskOf(response)

    expect(moved.column).toBe('in-progress')
    expect(moved.title).toBe('Refund API')
    expect(moved.context).toBe('partial amounts')
  })

  it('stamps closedAt when a task reaches done, and clears it when it comes back', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API' }))

    const done = await taskOf(
      await app.request(`/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ column: 'completed' })
      })
    )
    expect(done.closedAt).not.toBeNull()

    const reopened = await taskOf(
      await app.request(`/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ column: 'in-review' })
      })
    )
    expect(reopened.closedAt).toBeNull()
  })

  it('keeps closedAt while a patch that does not name a column lands', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API', column: 'completed' }))
    expect(task.closedAt).not.toBeNull()

    const renamed = await taskOf(
      await app.request(`/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ title: 'Refund API v2' })
      })
    )

    expect(renamed.closedAt).toBe(task.closedAt)
  })

  it('replaces the bound members on a patch that names them', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API', memberIds: ['m1', 'm2'] }))
    expect(task.memberIds).toEqual(['m1', 'm2'])

    const reassigned = await taskOf(
      await app.request(`/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ memberIds: ['m3'] })
      })
    )

    expect(reassigned.memberIds).toEqual(['m3'])
  })

  it('carries where an imported task came from', async () => {
    const task = await taskOf(
      await createTask({
        title: 'Refund API',
        source: { provider: 'plane', ref: 'ALC-11', url: 'https://plane.example/ALC-11' }
      })
    )

    expect(task.source).toEqual({
      provider: 'plane',
      ref: 'ALC-11',
      url: 'https://plane.example/ALC-11'
    })
  })

  // Re-importing a board is normal; it must not double the tickets.
  it('answers with the existing ticket when the same issue is imported twice', async () => {
    const first = await taskOf(
      await createTask({ title: 'Refund API', source: { provider: 'plane', ref: 'ALC-11' } })
    )
    const second = await taskOf(
      await createTask({ title: 'Refund API renamed', source: { provider: 'plane', ref: 'ALC-11' } })
    )

    expect(second.id).toBe(first.id)
    expect(second.number).toBe(first.number)
    expect(second.title).toBe('Refund API')
  })

  it('lets two projects import the same issue id', async () => {
    await createTask({ title: 'Refund API', source: { provider: 'plane', ref: 'ALC-11' } })
    const other = await app.request('/v1/projects', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Ledger', key: 'LED', repoIds: ['repo-ledger'] })
    })
    const otherProject = ((await other.json()) as { project: Project }).project

    const response = await app.request('/v1/tasks', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        projectId: otherProject.id,
        title: 'Refund API',
        source: { provider: 'plane', ref: 'ALC-11' }
      })
    })

    expect(response.status).toBe(201)
  })

  it('leaves a hand-typed task with no source', async () => {
    expect((await taskOf(await createTask({ title: 'Refund API' }))).source).toBeNull()
  })

  it('refuses a task for a project that does not exist', async () => {
    const response = await app.request('/v1/tasks', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ projectId: 'prj_missing', title: 'Orphan' })
    })

    expect(response.status).toBe(404)
  })

  it('rejects a title that is only whitespace', async () => {
    expect((await createTask({ title: '   ' })).status).toBe(400)
  })

  it('rejects a column that is not a workspace-status id', async () => {
    expect((await createTask({ title: 'Refund API', column: 'In Progress' })).status).toBe(400)
  })

  it('deletes a task and its member bindings', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API', memberIds: ['m1'] }))

    const deleted = await app.request(`/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: authHeaders
    })
    expect(deleted.status).toBe(204)

    const read = await app.request(`/v1/tasks/${task.id}`, { headers: authHeaders })
    expect(read.status).toBe(404)
    const remaining = await withTenant(pool, 'local', (client) =>
      client.query('SELECT 1 FROM task_members WHERE task_id = $1', [task.id])
    )
    expect(remaining.rowCount).toBe(0)
  })

  // Deleting a project takes its board with it; leaving orphan tickets would show a board for a
  // project that no longer exists.
  it('takes a project’s tasks with the project', async () => {
    const task = await taskOf(await createTask({ title: 'Refund API' }))

    await app.request(`/v1/projects/${project.id}`, { method: 'DELETE', headers: authHeaders })

    const read = await app.request(`/v1/tasks/${task.id}`, { headers: authHeaders })
    expect(read.status).toBe(404)
  })
})
