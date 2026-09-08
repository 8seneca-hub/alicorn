import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import { FEATURE_DELIVERY_TEMPLATE, type Workflow, type WorkflowTemplate } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_templates_test'

describePostgres('workflow template routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  const memberIdByName = new Map<string, string>()

  const authHeaders = { authorization: 'Bearer local-dev-token-0123456789', 'x-alicorn-actor': 'nghia' }
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' }

  async function fromTemplate(body: Record<string, unknown>): Promise<Response> {
    return app.request('/v1/workflows/from-template', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body)
    })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-templates-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })

    for (const member of [
      { name: 'Analyst', role: 'analyst', backend: 'claude' },
      { name: 'Developer', role: 'developer', backend: 'claude' },
      { name: 'Reviewer', role: 'reviewer', backend: 'codex' },
      { name: 'QA', role: 'qa', backend: 'claude' }
    ]) {
      const res = await app.request('/v1/members', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...member, workspaceKind: 'worktree', permissionMode: 'ask' })
      })
      memberIdByName.set(member.name, ((await res.json()) as { member: { id: string } }).member.id)
    }
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('lists the shipped templates', async () => {
    const res = await app.request('/v1/workflow-templates', { headers: authHeaders })
    const { templates } = (await res.json()) as { templates: WorkflowTemplate[] }
    expect(templates.map((t) => t.key)).toEqual(['feature-delivery'])
  })

  it('instantiates the template, binding roles to this tenant and leaving the human gates unowned', async () => {
    const res = await fromTemplate({ templateKey: 'feature-delivery', projectId: 'local' })
    expect(res.status).toBe(201)
    const { workflow } = (await res.json()) as { workflow: Workflow }
    expect(workflow.name).toBe('Feature delivery')
    expect(workflow.version).toBe(1)
    expect(workflow.stages.map((s) => s.key)).toEqual(FEATURE_DELIVERY_TEMPLATE.stages.map((s) => s.key))

    const byKey = new Map(workflow.stages.map((s) => [s.key, s]))
    expect(byKey.get('build')!.memberId).toBe(memberIdByName.get('Developer'))
    expect(byKey.get('review')!.memberId).toBe(memberIdByName.get('Reviewer'))
    expect(byKey.get('verify')!.memberId).toBe(memberIdByName.get('QA'))
    expect(byKey.get('spec')!.memberId).toBe(memberIdByName.get('Analyst'))
    // No member holds `other`, so Design lands unassigned rather than failing the instantiation.
    expect(byKey.get('design')!.memberId).toBeNull()
    // Merge and Deploy are human gates by design.
    expect(byKey.get('merge')!.memberId).toBeNull()
    expect(byKey.get('deploy')!.memberId).toBeNull()

    // The gates that must fire on run one, before any track record exists.
    expect(byKey.get('merge')!.reversibility).toBe('irreversible')
    expect(byKey.get('deploy')!.reversibility).toBe('irreversible')
    expect(byKey.get('architecture')!.inheritedCost).toBe('high')

    expect(workflow.transitions).toContainEqual({
      from: 'review',
      to: 'build',
      kind: 'correction',
      trigger: { kind: 'on_failure' }
    })
  })

  it('takes a caller-supplied name so one project can hold two instances', async () => {
    const res = await fromTemplate({ templateKey: 'feature-delivery', projectId: 'local', name: 'Hotfix delivery' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { workflow: Workflow }).workflow.name).toBe('Hotfix delivery')
  })

  it('rejects a second instance under the same name', async () => {
    const res = await fromTemplate({ templateKey: 'feature-delivery', projectId: 'local' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_name' })
  })

  it('404s an unknown template', async () => {
    const res = await fromTemplate({ templateKey: 'nope', projectId: 'local' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown_template' })
  })

  it('does not read from-template as a workflow id', async () => {
    const res = await app.request('/v1/workflows/from-template', { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('requires the bearer', async () => {
    expect((await app.request('/v1/workflow-templates')).status).toBe(401)
    expect(
      (await app.request('/v1/workflows/from-template', { method: 'POST', body: '{}' })).status
    ).toBe(401)
  })
})
