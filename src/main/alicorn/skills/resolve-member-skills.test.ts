import { describe, expect, it } from 'vitest'
import { resolveMemberSkills } from './resolve-member-skills'
import { projectSkillNames } from './project-skills'
import type { CatalogSkill } from '../../../shared/alicorn/skill-catalog'
import type { DiscoveredSkill } from '../../../shared/skills'

function catalog(over: Partial<CatalogSkill> & { name: string }): CatalogSkill {
  return {
    id: `skill-${over.name}`,
    tenantId: 'local',
    scope: 'org',
    projectId: null,
    packageId: null,
    latestVersionId: null,
    createdBy: 'admin',
    createdAt: '2026-09-09T00:00:00.000Z',
    ...over
  }
}

function discovered(over: Partial<DiscoveredSkill> & { name: string }): DiscoveredSkill {
  return {
    id: `disc-${over.name}`,
    description: null,
    providers: ['claude'],
    sourceKind: 'repo',
    sourceLabel: 'repo',
    rootPath: '/repo/.claude/skills',
    directoryPath: `/repo/.claude/skills/${over.name}`,
    skillFilePath: `/repo/.claude/skills/${over.name}/SKILL.md`,
    installed: true,
    updatedAt: null,
    ...over
  }
}

describe('resolveMemberSkills', () => {
  it('merges all three scopes and labels where each came from', () => {
    const resolved = resolveMemberSkills(
      [
        { name: 'code-review', versionId: null },
        { name: 'my-notes', versionId: null }
      ],
      [catalog({ name: 'code-review', latestVersionId: 'v5' })],
      ['repo-conventions']
    )
    expect(resolved).toEqual([
      { name: 'code-review', scope: 'org', versionId: 'v5', skillId: 'skill-code-review' },
      { name: 'my-notes', scope: 'member', versionId: null, skillId: null },
      { name: 'repo-conventions', scope: 'project', versionId: null, skillId: null }
    ])
  })

  it('a pin survives the catalog moving latest', () => {
    const pinned = [{ name: 'code-review', versionId: 'v2' }]
    const before = resolveMemberSkills(
      pinned,
      [catalog({ name: 'code-review', latestVersionId: 'v2' })],
      []
    )
    const after = resolveMemberSkills(
      pinned,
      [catalog({ name: 'code-review', latestVersionId: 'v9' })],
      []
    )
    expect(before[0]!.versionId).toBe('v2')
    expect(after[0]!.versionId).toBe('v2')
  })

  it('member pin > project: a pinned name resolves to the catalog row, not the repo copy', () => {
    const [entry] = resolveMemberSkills(
      [{ name: 'code-review', versionId: 'v2' }],
      [catalog({ name: 'code-review', latestVersionId: 'v9' })],
      ['code-review']
    )
    expect(entry).toEqual({
      name: 'code-review',
      scope: 'org',
      versionId: 'v2',
      skillId: 'skill-code-review'
    })
  })

  it('project > org: an unpinned name takes the repo-committed copy', () => {
    const [entry] = resolveMemberSkills(
      [{ name: 'code-review', versionId: null }],
      [catalog({ name: 'code-review', latestVersionId: 'v9' })],
      ['code-review']
    )
    expect(entry).toMatchObject({ scope: 'project', versionId: null })
  })

  it('a project-scoped catalog row shadows an org row of the same name', () => {
    const [entry] = resolveMemberSkills(
      [{ name: 'code-review', versionId: null }],
      [
        catalog({ name: 'code-review', latestVersionId: 'v9' }),
        catalog({
          id: 'proj-row',
          name: 'code-review',
          scope: 'project',
          projectId: 'p1',
          latestVersionId: 'v3'
        })
      ],
      []
    )
    expect(entry).toEqual({
      name: 'code-review',
      scope: 'project',
      versionId: 'v3',
      skillId: 'proj-row'
    })
  })

  it('the catalog is a menu, not a mandate: an unreferenced org skill is not resolved', () => {
    expect(resolveMemberSkills([], [catalog({ name: 'security-review' })], [])).toEqual([])
  })

  it('a repo-committed skill applies without the member naming it', () => {
    expect(resolveMemberSkills([], [], ['repo-conventions'])).toMatchObject([{ scope: 'project' }])
  })

  it('a private skill carries no catalog id, so a stage check cannot name it', () => {
    const [entry] = resolveMemberSkills([{ name: 'my-notes', versionId: 'v1' }], [], [])
    expect(entry).toEqual({ name: 'my-notes', scope: 'member', versionId: 'v1', skillId: null })
  })

  it('ignores blank names and lets the last reference to a name win', () => {
    expect(
      resolveMemberSkills(
        [
          { name: '  ', versionId: null },
          { name: 'a', versionId: 'v1' },
          { name: 'a', versionId: 'v2' }
        ],
        [catalog({ name: 'a' })],
        []
      )
    ).toEqual([{ name: 'a', scope: 'org', versionId: 'v2', skillId: 'skill-a' }])
  })
})

describe('projectSkillNames', () => {
  it('keeps repo-committed skills only', () => {
    expect(
      projectSkillNames([
        discovered({ name: 'repo-conventions' }),
        discovered({ name: 'home-thing', sourceKind: 'home' }),
        discovered({ name: 'bundled-thing', sourceKind: 'bundled' }),
        discovered({ name: 'plugin-thing', sourceKind: 'plugin' }),
        discovered({ name: 'repo-conventions', id: 'other-root' })
      ])
    ).toEqual(['repo-conventions'])
  })
})
