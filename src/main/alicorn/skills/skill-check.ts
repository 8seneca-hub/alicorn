import type { SkillCheck } from '../../../shared/alicorn/members'
import type { ResolvedSkill } from '../../../shared/alicorn/skill-catalog'
import type { StepVerificationInput } from '../../../shared/alicorn/ledger-inputs'

export type SkillCheckResult = {
  status: StepVerificationInput['status']
  detail: Record<string, unknown>
}

/**
 * OP2b's verdict: did the member that did the work actually have the skill the project requires?
 *
 * A member cannot loosen its own criteria — `check` comes from the project's admin-authored list
 * and `catalog` is the admin-authored row it names. All this decides is whether `resolved` (from
 * `resolveMemberSkills`) contains that skill at the required version.
 *
 * Pure, so the interesting half needs no control plane and no filesystem.
 */
export function resolveSkillCheck(
  check: SkillCheck,
  /** The catalog row's name — the only thing that maps the check's `skillId` onto a resolved
   *  skill. Null when the catalog no longer holds the id. */
  catalogName: string | null,
  resolved: readonly ResolvedSkill[]
): SkillCheckResult {
  // The Control API refuses an unknown `skillId` at authoring time, so a miss here means the row
  // was deleted afterwards. `error`, not `failed`: nothing was judged.
  if (catalogName === null) {
    return { status: 'error', detail: { reason: 'unknown_skill', skillId: check.skillId } }
  }
  const held = resolved.find((skill) => skill.name === catalogName) ?? null
  if (!held) {
    return {
      status: 'failed',
      detail: { reason: 'skill_not_resolved', skillId: check.skillId, skill: catalogName }
    }
  }
  // Only an explicitly pinned check asserts a version. An unpinned one follows the catalog's
  // `latest`, which is a statement about which content runs — not a demand that the member be on
  // it, and comparing against a moving target would fail every repo-committed copy by definition.
  const required = check.versionId
  if (required !== undefined && held.versionId !== required) {
    return {
      status: 'failed',
      detail: {
        reason: 'version_mismatch',
        skillId: check.skillId,
        skill: catalogName,
        required,
        resolved: held.versionId,
        scope: held.scope
      }
    }
  }
  return {
    status: 'passed',
    detail: {
      skillId: check.skillId,
      skill: catalogName,
      scope: held.scope,
      versionId: held.versionId
    }
  }
}
