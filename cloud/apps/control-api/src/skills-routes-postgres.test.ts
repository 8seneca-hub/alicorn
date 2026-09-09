import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool,
  withTenant
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_skills_test'

const DIGEST = 'a'.repeat(64)

describePostgres('skill catalog routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

  const authHeaders = { authorization: 'Bearer local-dev-token-0123456789', 'x-alicorn-actor': 'huy' }
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-skills-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  async function createSkill(body: unknown): Promise<Response> {
    return app.request('/v1/skills', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) })
  }

  async function idOf(body: unknown): Promise<string> {
    const res = await createSkill(body)
    expect(res.status).toBe(201)
    return ((await res.json()) as { skill: { id: string } }).skill.id
  }

  it('creates an org skill and lists it', async () => {
    const res = await createSkill({ name: 'threat-model' })
    expect(res.status).toBe(201)
    const { skill } = (await res.json()) as { skill: Record<string, unknown> }
    expect(skill).toMatchObject({
      scope: 'org',
      projectId: null,
      name: 'threat-model',
      latestVersionId: null,
      createdBy: 'huy'
    })

    const list = await app.request('/v1/skills?scope=org', { headers: authHeaders })
    const { skills } = (await list.json()) as { skills: { name: string }[] }
    expect(skills.map((s) => s.name)).toContain('threat-model')
  })

  it('rejects a project skill with no project and an org skill carrying one', async () => {
    expect((await createSkill({ scope: 'project', name: 'a' })).status).toBe(400)
    expect((await createSkill({ scope: 'org', name: 'a', projectId: 'repo-1' })).status).toBe(400)
  })

  it('scopes a project skill to its project in the listing', async () => {
    await idOf({ scope: 'project', projectId: 'repo-1', name: 'house-style' })
    const res = await app.request('/v1/skills?projectId=repo-1', { headers: authHeaders })
    const { skills } = (await res.json()) as { skills: { name: string }[] }
    expect(skills.map((s) => s.name)).toEqual(['house-style'])
  })

  it('answers 409 for a second org skill of the same name', async () => {
    await idOf({ name: 'duplicated' })
    expect((await createSkill({ name: 'duplicated' })).status).toBe(409)
  })

  it('publishes a version idempotently and keeps the first digest', async () => {
    const id = await idOf({ name: 'reviewer-rubric' })
    const publish = async (digest: string): Promise<Response> =>
      app.request(`/v1/skills/${id}/versions`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ versionId: 'v1', digest, manifest: { name: 'reviewer-rubric' } })
      })
    expect((await publish(DIGEST)).status).toBe(200)
    // A re-post is a no-op: a stage check pins a version, so rewriting one would silently change
    // what an already-authored check means.
    const second = await publish('b'.repeat(64))
    expect(((await second.json()) as { version: { digest: string } }).version.digest).toBe(DIGEST)

    const rows = await withTenant(pool, 'local', (client) =>
      client.query('SELECT count(*)::int AS n FROM skill_versions WHERE skill_id = $1', [id])
    )
    expect(rows.rows[0].n).toBe(1)
  })

  it('moves latest only to a version that exists', async () => {
    const id = await idOf({ name: 'latest-moves' })
    const setLatest = async (versionId: string): Promise<Response> =>
      app.request(`/v1/skills/${id}/latest`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ versionId })
      })
    expect((await setLatest('v9')).status).toBe(400)
    await app.request(`/v1/skills/${id}/versions`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ versionId: 'v1', digest: DIGEST })
    })
    expect((await setLatest('v1')).status).toBe(200)

    const get = await app.request(`/v1/skills/${id}`, { headers: authHeaders })
    const body = (await get.json()) as { skill: { latestVersionId: string }; versions: unknown[] }
    expect(body.skill.latestVersionId).toBe('v1')
    expect(body.versions).toHaveLength(1)
  })

  it('answers 404 for an unknown skill and refuses an unauthenticated read', async () => {
    expect((await app.request('/v1/skills/skl_nope', { headers: authHeaders })).status).toBe(404)
    expect((await app.request('/v1/skills')).status).toBe(401)
  })

  describe('required checks referencing a catalog skill (OP2b)', () => {
    async function putChecks(projectId: string, checks: unknown): Promise<Response> {
      return app.request(`/v1/projects/${projectId}/required-checks`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ checks })
      })
    }

    it('stores a check naming an org skill, at a pinned version', async () => {
      const id = await idOf({ name: 'qa-rubric' })
      await app.request(`/v1/skills/${id}/versions`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ versionId: 'v2', digest: DIGEST })
      })
      const res = await putChecks('repo-checks', [{ kind: 'skill', skillId: id, versionId: 'v2' }])
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ checks: [{ kind: 'skill', skillId: id, versionId: 'v2' }] })
    })

    it('refuses an unknown skill id, an unpublished version, and another project’s skill', async () => {
      const unknown = await putChecks('repo-checks', [{ kind: 'skill', skillId: 'skl_nope' }])
      expect(unknown.status).toBe(400)
      expect(await unknown.json()).toEqual({ error: 'unknown_skill', skillIds: ['skl_nope'] })

      const id = await idOf({ name: 'unpinnable' })
      expect((await putChecks('repo-checks', [{ kind: 'skill', skillId: id, versionId: 'v7' }])).status).toBe(400)

      const foreign = await idOf({ scope: 'project', projectId: 'repo-other', name: 'foreign' })
      expect((await putChecks('repo-checks', [{ kind: 'skill', skillId: foreign }])).status).toBe(400)
      expect((await putChecks('repo-other', [{ kind: 'skill', skillId: foreign }])).status).toBe(200)
    })

    it('refuses a workflow stage naming a skill outside the catalog', async () => {
      const res = await app.request('/v1/workflows', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          projectId: 'repo-wf',
          name: 'gated',
          stages: [
            {
              key: 'build',
              name: 'Build',
              ordinal: 0,
              memberId: null,
              columnId: null,
              kind: 'worker',
              codeCommand: null,
              reversibility: 'contained',
              inheritedCost: 'low',
              requiredChecks: [{ kind: 'skill', skillId: 'skl_nope' }]
            }
          ],
          transitions: []
        })
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'unknown_skill', skillIds: ['skl_nope'] })
    })
  })

  it('round-trips a member skill pinned to a version, and a bare string as follow-latest', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'pinner',
        role: 'reviewer',
        backend: 'codex',
        workspaceKind: 'worktree',
        permissionMode: 'ask',
        skills: ['threat-model', { name: 'reviewer-rubric', versionId: 'v1' }]
      })
    })
    expect(res.status).toBe(201)
    const { member } = (await res.json()) as { member: { id: string; skills: unknown[] } }
    expect(member.skills).toEqual([
      { name: 'reviewer-rubric', versionId: 'v1' },
      { name: 'threat-model', versionId: null }
    ])

    const get = await app.request(`/v1/members/${member.id}`, { headers: authHeaders })
    expect(((await get.json()) as { member: { skills: unknown[] } }).member.skills).toEqual(member.skills)
  })
})
