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
import type { Project } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'
import { resolveProjectId } from './projects-repository.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_projects_test'

describePostgres('projects routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

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
      applicationName: 'control-api-projects-test'
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
  })

  async function create(body: unknown): Promise<Response> {
    return app.request('/v1/projects', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body)
    })
  }

  async function createdProject(body: unknown): Promise<Project> {
    const response = await create(body)
    expect(response.status).toBe(201)
    return ((await response.json()) as { project: Project }).project
  }

  it('creates a project that owns its repositories', async () => {
    const project = await createdProject({
      name: 'Payments Platform',
      key: 'PAY',
      repoIds: ['repo-payments', 'repo-notifications']
    })

    expect(project.name).toBe('Payments Platform')
    expect(project.key).toBe('PAY')
    expect(project.repoIds.slice().sort()).toEqual(['repo-notifications', 'repo-payments'])
    expect(project.id.startsWith('prj_')).toBe(true)
  })

  it('lists projects by name with their repositories', async () => {
    await createdProject({ name: 'Runtime', key: 'RUN', repoIds: ['repo-runtime'] })
    await createdProject({ name: 'Payments', key: 'PAY', repoIds: [] })

    const response = await app.request('/v1/projects', { headers: authHeaders })
    const { projects } = (await response.json()) as { projects: Project[] }
    expect(projects.map((p) => p.name)).toEqual(['Payments', 'Runtime'])
    expect(projects[1]!.repoIds).toEqual(['repo-runtime'])
  })

  it('refuses a second project with the same key', async () => {
    await createdProject({ name: 'Payments', key: 'PAY', repoIds: [] })
    const response = await create({ name: 'Payouts', key: 'PAY', repoIds: [] })
    expect(response.status).toBe(409)
  })

  it('rejects a key that would not read as a task prefix', async () => {
    const response = await create({ name: 'Payments', key: 'payments platform', repoIds: [] })
    expect(response.status).toBe(400)
  })

  it('replaces the repository set on update rather than merging it', async () => {
    const project = await createdProject({
      name: 'Payments',
      key: 'PAY',
      repoIds: ['repo-a', 'repo-b']
    })
    const response = await app.request(`/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Payments', key: 'PAY', repoIds: ['repo-b'] })
    })
    expect(response.status).toBe(200)
    const { project: updated } = (await response.json()) as { project: Project }
    expect(updated.repoIds).toEqual(['repo-b'])
  })

  // One project per repo is what makes "which project is this gate in" answerable at all.
  it('moves a repository rather than letting two projects claim it', async () => {
    const first = await createdProject({ name: 'First', key: 'FST', repoIds: ['repo-shared'] })
    const second = await createdProject({ name: 'Second', key: 'SND', repoIds: ['repo-shared'] })

    const response = await app.request(`/v1/projects/${first.id}`, { headers: authHeaders })
    const { project } = (await response.json()) as { project: Project }
    expect(project.repoIds).toEqual([])
    expect(second.repoIds).toEqual(['repo-shared'])
  })

  it('deletes a project and unbinds its repositories', async () => {
    const project = await createdProject({ name: 'Payments', key: 'PAY', repoIds: ['repo-a'] })
    const response = await app.request(`/v1/projects/${project.id}`, {
      method: 'DELETE',
      headers: authHeaders
    })
    expect(response.status).toBe(204)
    expect(await resolveProjectId(pool, 'local', 'repo-a')).toBe('repo-a')
  })

  // The point of the entity: configuration follows the project, and a repository bound to it
  // reads the project's answer rather than keeping a second, separate one of its own.
  it('serves a project\'s required checks when asked through a repository it owns', async () => {
    const project = await createdProject({
      name: 'Payments',
      key: 'PAY',
      repoIds: ['repo-payments']
    })
    // threshold is a fraction here, not a percentage — see required-check.ts.
    const checks = [
      { kind: 'diff_coverage', threshold: 0.8, lcovPath: 'coverage/lcov.info', timeoutMs: 60000 }
    ]
    const put = await app.request(`/v1/projects/${project.id}/required-checks`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ checks })
    })
    expect(put.status).toBe(200)

    const viaRepo = await app.request('/v1/projects/repo-payments/required-checks', {
      headers: authHeaders
    })
    expect(viaRepo.status).toBe(200)
    expect((await viaRepo.json()) as unknown).toEqual({ checks })
  })

  // And the opt-in clause: an unbound repository keeps answering for itself.
  it('keeps an unbound repository on its own configuration', async () => {
    const checks = [{ kind: 'contract_acknowledged' }]
    await app.request('/v1/projects/repo-loose/required-checks', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ checks })
    })
    const read = await app.request('/v1/projects/repo-loose/required-checks', {
      headers: authHeaders
    })
    expect((await read.json()) as unknown).toEqual({ checks })
  })

  it('answers 404 for a project that is not there', async () => {
    const response = await app.request('/v1/projects/prj_missing', { headers: authHeaders })
    expect(response.status).toBe(404)
  })
})

describePostgres('resolveProjectId — the compatibility read path', () => {
  let pool: pg.Pool
  const compatSchema = 'control_projects_compat_test'

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, compatSchema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema: compatSchema,
      applicationName: 'control-api-projects-compat-test'
    })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestSchema(databaseUrl!, compatSchema)
  })

  // The clause that makes adoption opt-in: a tenant with no projects behaves exactly as before.
  it('returns an unbound id unchanged, so pre-project behaviour is untouched', async () => {
    expect(await resolveProjectId(pool, 'local', 'repo-never-bound')).toBe('repo-never-bound')
  })

  it('resolves a bound repository to the project that owns it', async () => {
    const id = await withTenant(pool, 'local', async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, key, created_by)
         VALUES ('local', 'Payments', 'PAY', 'huy') RETURNING id`
      )
      const projectId = rows[0]!.id
      await client.query(
        `INSERT INTO project_repos (tenant_id, project_id, repo_id) VALUES ('local', $1, 'repo-a')`,
        [projectId]
      )
      return projectId
    })

    expect(await resolveProjectId(pool, 'local', 'repo-a')).toBe(id)
    expect(await resolveProjectId(pool, 'local', id)).toBe(id)
  })
})
