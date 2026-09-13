// Hand-mirrored from cloud/packages/control-plane-contract/src/skill.ts (OP2). The desktop does
// not import the contract package, so a rename there is a silent break here.

export const SKILL_SCOPES = ['member', 'project', 'org'] as const

/**
 * PS1's third scope. `org` is the admin-authored catalog, `project` is a repo-committed skill dir
 * Alicorn already discovers, `member` is the member's own — the only one with no catalog id, which is
 * exactly what keeps it unnameable by a stage check.
 *
 * The catalog itself only knows `org | project`; `member` exists only in a resolved list.
 */
export type SkillScope = (typeof SKILL_SCOPES)[number]

/** A row of the org skill catalog. `scope` here is never `'member'`. */
export type CatalogSkill = {
  id: string
  tenantId: string
  scope: 'org' | 'project'
  projectId: string | null
  name: string
  packageId: string | null
  latestVersionId: string | null
  createdBy: string
  createdAt: string
}

/** One entry of `resolveMemberSkills` — what the member actually gets, and where it came from. */
export type ResolvedSkill = {
  name: string
  scope: SkillScope
  /** Null when nothing versions it: a repo-committed skill is versioned by its commit. */
  versionId: string | null
  /** The catalog row, when one backs this name. Null for a member's private skill. */
  skillId: string | null
}
