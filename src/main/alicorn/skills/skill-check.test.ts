import { describe, expect, it } from 'vitest'
import { resolveSkillCheck } from './skill-check'
import type { CatalogSkill, ResolvedSkill } from '../../../shared/alicorn/skill-catalog'

const catalogSkill: CatalogSkill = {
  id: 'sk-1',
  tenantId: 'local',
  scope: 'org',
  projectId: null,
  name: 'security-review',
  packageId: null,
  latestVersionId: 'v5',
  createdBy: 'admin',
  createdAt: '2026-09-09T00:00:00.000Z'
}

const held = (over: Partial<ResolvedSkill> = {}): ResolvedSkill => ({
  name: 'security-review',
  scope: 'org',
  versionId: 'v5',
  skillId: 'sk-1',
  ...over
})

describe('resolveSkillCheck', () => {
  it('passes when the member resolved the skill', () => {
    const result = resolveSkillCheck({ kind: 'skill', skillId: 'sk-1' }, catalogSkill.name, [
      held()
    ])
    expect(result.status).toBe('passed')
    expect(result.detail).toMatchObject({ skill: 'security-review', scope: 'org' })
  })

  it('fails when the member never had it — the catalog is not a mandate', () => {
    const result = resolveSkillCheck({ kind: 'skill', skillId: 'sk-1' }, catalogSkill.name, [])
    expect(result).toEqual({
      status: 'failed',
      detail: { reason: 'skill_not_resolved', skillId: 'sk-1', skill: 'security-review' }
    })
  })

  it('fails on a pinned version the member is not on', () => {
    const result = resolveSkillCheck(
      { kind: 'skill', skillId: 'sk-1', versionId: 'v7' },
      catalogSkill.name,
      [held()]
    )
    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({
      reason: 'version_mismatch',
      required: 'v7',
      resolved: 'v5'
    })
  })

  it('an unpinned check does not demand the catalog latest, so a repo-committed copy passes', () => {
    const result = resolveSkillCheck({ kind: 'skill', skillId: 'sk-1' }, catalogSkill.name, [
      held({ scope: 'project', versionId: null })
    ])
    expect(result.status).toBe('passed')
  })

  it('errors rather than fails when the catalog row is gone — nothing was judged', () => {
    const result = resolveSkillCheck({ kind: 'skill', skillId: 'sk-1' }, null, [held()])
    expect(result).toEqual({
      status: 'error',
      detail: { reason: 'unknown_skill', skillId: 'sk-1' }
    })
  })
})
