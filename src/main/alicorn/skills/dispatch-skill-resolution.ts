import { discoverSkills } from '../../skills/discovery'
import type { DiscoveredSkill } from '../../../shared/skills'
import type { CatalogSkill, ResolvedSkill } from '../../../shared/alicorn/skill-catalog'
import { fetchMemberSkills, fetchSkillCatalog } from './skill-catalog-fetch'
import { projectSkillNames } from './project-skills'
import { resolveMemberSkills } from './resolve-member-skills'

export type DispatchSkillResolution = {
  resolved: ResolvedSkill[]
  /** The check names a `skillId`; only the catalog maps it onto a resolved skill's name. */
  catalogNameById: Map<string, string>
}

export type DispatchSkillResolverDeps = {
  /** Who did the work. Read from the client's own store, not the outbox payload — the member is
   *  already recorded per dispatch, and a second copy is a second thing to keep true. */
  getMemberId: (dispatchId: string) => string | null
  fetchCatalog?: (projectId: string) => Promise<CatalogSkill[]>
  fetchMemberRefs?: (
    memberId: string | null
  ) => Promise<{ name: string; versionId: string | null }[]>
  /** Repo-committed skills in the worktree. Local only — the caller has already ruled out SSH. */
  discoverRepoSkills?: (worktreePath: string) => Promise<DiscoveredSkill[]>
}

/**
 * PS1. What a `{ kind: 'skill' }` required check is evaluated against: the member's resolved
 * skills for this worktree, merged from all three scopes.
 *
 * `includeCwd` is the point of the discovery call — the worktree's `.claude/skills` and
 * `.agents/skills` are the project scope, and nothing else in the scan is.
 */
export function createDispatchSkillResolver(deps: DispatchSkillResolverDeps) {
  const fetchCatalog = deps.fetchCatalog ?? fetchSkillCatalog
  const fetchMemberRefs = deps.fetchMemberRefs ?? fetchMemberSkills
  const discoverRepoSkills =
    deps.discoverRepoSkills ??
    (async (worktreePath: string) => (await discoverSkills({ cwd: worktreePath })).skills)

  return async (input: {
    projectId: string
    dispatchId: string
    worktreePath: string
  }): Promise<DispatchSkillResolution> => {
    const [catalog, memberRefs, discovered] = await Promise.all([
      fetchCatalog(input.projectId),
      fetchMemberRefs(deps.getMemberId(input.dispatchId)),
      discoverRepoSkills(input.worktreePath)
    ])
    return {
      resolved: resolveMemberSkills(memberRefs, catalog, projectSkillNames(discovered)),
      catalogNameById: new Map(catalog.map((skill) => [skill.id, skill.name]))
    }
  }
}
