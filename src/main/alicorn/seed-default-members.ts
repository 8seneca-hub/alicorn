/**
 * Giving a fresh install its core members.
 *
 * A library with nothing in it is a product that cannot do anything on the day it is installed —
 * there is no one to assign a task to and no one for a workflow stage to dispatch. So the shipped
 * set is created once, the first time the library is found empty.
 *
 * Only when empty, and never again. This is a seed, not a sync: a member someone renamed, retuned
 * or deleted is a decision, and re-creating it on the next launch would quietly overrule them.
 */
import { DEFAULT_MEMBERS } from '../../shared/alicorn/default-members'
import type { ControlPlaneClient } from './control-plane-client'

export async function seedDefaultMembers(
  client: ControlPlaneClient | null
): Promise<{ seeded: number }> {
  if (!client) {
    return { seeded: 0 }
  }
  const existing = await client.listMembers()
  if (existing.length > 0) {
    return { seeded: 0 }
  }
  let seeded = 0
  for (const entry of DEFAULT_MEMBERS) {
    // One at a time, and a failure does not abandon the rest: a partly seeded library is still
    // usable, and the next empty-library launch will not run again once any member exists.
    try {
      await client.createMember(entry.member)
      seeded += 1
    } catch (error) {
      console.warn(`[alicorn] could not seed member ${entry.member.name}`, error)
    }
  }
  return { seeded }
}
