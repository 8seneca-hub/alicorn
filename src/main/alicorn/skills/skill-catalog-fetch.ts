import { alicornFetch } from '../control-plane-http'
import type { Member } from '../../../shared/alicorn/members'
import type { CatalogSkill } from '../../../shared/alicorn/skill-catalog'

// PS1. Same posture as required-checks-fetch (R9): alicornFetch only, never the member directory
// or the control-plane client — the verification worker is a drainer branch, not a UI path.

async function readJson<T>(path: string): Promise<T> {
  const res = await alicornFetch('control', path)
  return (await res.json()) as T
}

/**
 * The org catalog plus this project's rows. Two reads rather than one unfiltered `GET /v1/skills`:
 * unfiltered returns every project's rows, and resolution must not be able to pick up a skill
 * another project committed.
 */
export async function fetchSkillCatalog(projectId: string): Promise<CatalogSkill[]> {
  const [org, project] = await Promise.all([
    readJson<{ skills?: CatalogSkill[] }>('/v1/skills?scope=org'),
    readJson<{ skills?: CatalogSkill[] }>(
      `/v1/skills?scope=project&projectId=${encodeURIComponent(projectId)}`
    )
  ])
  return [...(org.skills ?? []), ...(project.skills ?? [])]
}

/** The member's own references. Empty for a direct launch, which has no member to reference any. */
export async function fetchMemberSkills(memberId: string | null): Promise<Member['skills']> {
  if (memberId === null) {
    return []
  }
  const body = await readJson<{ members?: Member[] }>('/v1/members')
  return body.members?.find((member) => member.id === memberId)?.skills ?? []
}
