import type { MemberSkillRef } from '../../../shared/alicorn/members'
import type { CatalogSkill, ResolvedSkill } from '../../../shared/alicorn/skill-catalog'

/**
 * PS1/SP1b. Which skills a member actually has, given the three scopes that can supply one.
 *
 * **Membership** — the resolved set is *the names the member references* ∪ *the project's
 * repo-committed skills*. The org catalog is a menu, not a mandate: a catalog row nobody
 * references is available to be named, not silently handed to every member. That is what gives a
 * `{ kind: 'skill' }` required check something to fail on — if the check names a catalog skill the
 * member was never given, the honest answer is "it did not have it", not "everyone has everything".
 *
 * **Precedence — member pin > project > org**, decided per name, first branch wins:
 *
 * 1. *The member pinned a version and the catalog backs the name* → the catalog row at that
 *    version. A pin only means something against the catalog, and it must survive `latest` moving;
 *    that is the whole point of pinning, so it outranks the repo copy.
 * 2. *The repo commits it* → scope `project`, no version: a repo-committed skill is versioned by
 *    its commit and reviewed in the same PR as the work.
 * 3. *The catalog holds it* → the catalog row at its `latestVersionId`. A project-scoped catalog
 *    row shadows an org one of the same name — it is the narrower author.
 * 4. *Only the member names it* → its own private skill: scope `member`, `skillId: null`, and
 *    therefore unnameable by a stage check by construction.
 *
 * Pure — the fetching lives in `project-skills.ts` and the member directory.
 */
export function resolveMemberSkills(
  memberSkills: readonly MemberSkillRef[],
  orgCatalog: readonly CatalogSkill[],
  projectSkillNames: readonly string[]
): ResolvedSkill[] {
  const referenced = new Map<string, string | null>()
  for (const ref of memberSkills) {
    const name = ref.name.trim()
    if (name.length === 0) {
      continue
    }
    // Last reference wins: a duplicated name in one member's list is an authoring slip, and
    // dropping the later one would make an edit look like it did nothing.
    referenced.set(name, ref.versionId)
  }

  const catalogByName = new Map<string, CatalogSkill>()
  for (const skill of orgCatalog) {
    const held = catalogByName.get(skill.name)
    if (!held || (held.scope === 'org' && skill.scope === 'project')) {
      catalogByName.set(skill.name, skill)
    }
  }

  const fromRepo = new Set(projectSkillNames.map((name) => name.trim()).filter(Boolean))

  return [...new Set([...referenced.keys(), ...fromRepo])].sort().map((name) => {
    const catalog = catalogByName.get(name) ?? null
    const pin = referenced.get(name) ?? null

    if (pin !== null && catalog) {
      return { name, scope: catalog.scope, versionId: pin, skillId: catalog.id }
    }
    if (fromRepo.has(name)) {
      return { name, scope: 'project', versionId: null, skillId: catalog?.id ?? null }
    }
    if (catalog) {
      return { name, scope: catalog.scope, versionId: catalog.latestVersionId, skillId: catalog.id }
    }
    // Nothing in the catalog carries the name, so the pin is the member's own claim about its own
    // skill — kept rather than dropped, so a check that required a version fails loudly.
    return { name, scope: 'member', versionId: pin, skillId: null }
  })
}
