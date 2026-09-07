import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import type { Workflow } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_workflows_test'

describePostgres('workflows routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let memberId: string

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'nghia'
  }
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' }

  const graph = (over: Record<string, unknown> = {}) => ({
    projectId: 'local',
    name: 'Feature delivery',
    stages: [
      { key: 'spec', ordinal: 0 },
      { key: 'build', ordinal: 1, memberId, reversibility: 'contained' },
      { key: 'review', ordinal: 2, requiredChecks: [{ kind: 'diff_coverage', threshold: 0.8 }] }
    ],
    transitions: [
      { from: 'spec', to: 'build', trigger: { kind: 'on_success' } },
      { from: 'build', to: 'review', trigger: { kind: 'on_success' } },
      { from: 'review', to: 'build', trigger: { kind: 'on_failure' } }
    ],
    ...over
  })

  async function create(body: Record<string, unknown>): Promise<Response> {
    return app.request('/v1/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) })
  }

  async function put(id: string, body: Record<string, unknown>): Promise<Response> {
    return app.request(`/v1/workflows/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-workflows-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })

    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Developer',
        role: 'developer',
        backend: 'claude',
        workspaceKind: 'worktree',
        permissionMode: 'accept_edits'
      })
    })
    memberId = ((await res.json()) as { member: { id: string } }).member.id
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('creates a workflow at version 1 and reads the graph back in ordinal order', async () => {
    const res = await create(graph())
    expect(res.status).toBe(201)
    const { workflow } = (await res.json()) as { workflow: Workflow }
    expect(workflow.version).toBe(1)
    expect(workflow.createdBy).toBe('nghia')
    expect(workflow.stages.map((s) => s.key)).toEqual(['spec', 'build', 'review'])
    // An unnamed stage displays as its key; the safe reversibility default is stored, not inferred.
    expect(workflow.stages[0]).toMatchObject({ name: 'spec', reversibility: 'contained', inheritedCost: 'low' })
    expect(workflow.stages[1]!.memberId).toBe(memberId)
    expect(workflow.stages[2]!.requiredChecks[0]).toMatchObject({
      kind: 'diff_coverage',
      threshold: 0.8,
      lcovPath: 'coverage/lcov.info'
    })
    expect(workflow.transitions).toHaveLength(3)

    const listed = await app.request('/v1/workflows?projectId=local', { headers: authHeaders })
    expect((await listed.json()) as unknown).toMatchObject({ workflows: [{ name: 'Feature delivery', stageCount: 3 }] })
  })

  it('rejects a duplicate name in the same project', async () => {
    const res = await create(graph())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_name' })
  })

  it('rejects a member from outside the tenant', async () => {
    const res = await create(graph({ name: 'Bad member', stages: [{ key: 'spec', ordinal: 0, memberId: 'nope' }], transitions: [] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown_member', memberIds: ['nope'] })
  })

  it('bumps the version by exactly one and reorders stages in a single save', async () => {
    const created = (await (await create(graph({ name: 'Reorder' }))).json()) as { workflow: Workflow }
    const res = await put(created.workflow.id, {
      ...graph({ name: 'Reorder' }),
      version: created.workflow.version,
      stages: [
        { key: 'build', ordinal: 0, memberId },
        { key: 'spec', ordinal: 1 },
        { key: 'review', ordinal: 2 }
      ],
      transitions: [{ from: 'build', to: 'review', trigger: { kind: 'on_success' } }]
    })
    expect(res.status).toBe(200)
    const { workflow } = (await res.json()) as { workflow: Workflow }
    expect(workflow.version).toBe(2)
    expect(workflow.stages.map((s) => s.key)).toEqual(['build', 'spec', 'review'])
  })

  it('rejects a stale version and reports the current one', async () => {
    const created = (await (await create(graph({ name: 'Conflict' }))).json()) as { workflow: Workflow }
    await put(created.workflow.id, { ...graph({ name: 'Conflict' }), version: 1 })
    const res = await put(created.workflow.id, { ...graph({ name: 'Conflict' }), version: 1 })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'version_conflict', version: 2 })
  })

  it('drops a renamed stage and the edges that pointed at it', async () => {
    const created = (await (await create(graph({ name: 'Rename' }))).json()) as { workflow: Workflow }
    const res = await put(created.workflow.id, {
      ...graph({ name: 'Rename' }),
      version: 1,
      stages: [
        { key: 'spec', ordinal: 0 },
        { key: 'implement', ordinal: 1 },
        { key: 'review', ordinal: 2 }
      ],
      transitions: [{ from: 'spec', to: 'implement', trigger: { kind: 'on_success' } }]
    })
    const { workflow } = (await res.json()) as { workflow: Workflow }
    expect(workflow.stages.map((s) => s.key)).toEqual(['spec', 'implement', 'review'])
    expect(workflow.transitions).toEqual([{ from: 'spec', to: 'implement', trigger: { kind: 'on_success' } }])
  })

  it('unassigns a stage when its member is deleted rather than losing the workflow', async () => {
    const created = (await (await create(graph({ name: 'Orphan' }))).json()) as { workflow: Workflow }
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Temp',
        role: 'qa',
        backend: 'claude',
        workspaceKind: 'worktree',
        permissionMode: 'ask'
      })
    })
    const tempId = ((await res.json()) as { member: { id: string } }).member.id
    await put(created.workflow.id, {
      ...graph({ name: 'Orphan' }),
      version: 1,
      stages: [{ key: 'spec', ordinal: 0, memberId: tempId }],
      transitions: []
    })
    expect((await app.request(`/v1/members/${tempId}`, { method: 'DELETE', headers: authHeaders })).status).toBe(204)

    const after = await app.request(`/v1/workflows/${created.workflow.id}`, { headers: authHeaders })
    const { workflow } = (await after.json()) as { workflow: Workflow }
    expect(workflow.stages[0]!.memberId).toBeNull()
  })

  // Why through Postgres and not only the contract: `kind` and `code_command` arrive on an existing
  // table through ALTER, so a stage that validates can still fail to store.
  it('stores a code stage with its command and no member', async () => {
    const res = await create(
      graph({
        name: 'With a code stage',
        stages: [
          { key: 'build', ordinal: 0, memberId },
          {
            key: 'format',
            name: 'Format',
            ordinal: 1,
            kind: 'code',
            codeCommand: 'pnpm format',
            columnId: 'in-review'
          }
        ],
        transitions: [{ from: 'build', to: 'format', trigger: { kind: 'on_success' } }]
      })
    )
    expect(res.status).toBe(201)
    const { workflow } = (await res.json()) as { workflow: Workflow }
    expect(workflow.stages[1]).toMatchObject({
      kind: 'code',
      codeCommand: 'pnpm format',
      memberId: null,
      columnId: 'in-review'
    })
    // A worker stage keeps the default, so an existing workflow is unchanged by the new columns.
    expect(workflow.stages[0]).toMatchObject({ kind: 'worker', codeCommand: null })
  })

  it('refuses a code stage with nothing to run', async () => {
    const res = await create(
      graph({
        name: 'Code with no command',
        stages: [{ key: 'format', ordinal: 0, kind: 'code' }],
        transitions: []
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_body' })
  })

  it('rejects an invalid graph before it reaches Postgres', async () => {
    const res = await create(graph({ name: 'Bad', transitions: [{ from: 'spec', to: 'qa', trigger: { kind: 'on_success' } }] }))
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_body' })
  })

  it('deletes a workflow and 404s afterwards', async () => {
    const created = (await (await create(graph({ name: 'Doomed' }))).json()) as { workflow: Workflow }
    expect((await app.request(`/v1/workflows/${created.workflow.id}`, { method: 'DELETE', headers: authHeaders })).status).toBe(204)
    expect((await app.request(`/v1/workflows/${created.workflow.id}`, { headers: authHeaders })).status).toBe(404)
    expect((await app.request(`/v1/workflows/${created.workflow.id}`, { method: 'DELETE', headers: authHeaders })).status).toBe(404)
  })

  it('requires the bearer on the new prefix', async () => {
    expect((await app.request('/v1/workflows')).status).toBe(401)
  })
})
