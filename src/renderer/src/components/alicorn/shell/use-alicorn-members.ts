/**
 * The org's members, read once per mount from the control plane.
 *
 * Every project consumes the same library, so this is org-wide by design — a project only ever
 * stores an override, and overrides are not built yet (see AlicornProjectMembers).
 */
import { useEffect, useState } from 'react'
import type { Member } from '../../../../../shared/alicorn/members'

export type AlicornMembersState = {
  members: Member[] | null
  /** Null until the read settles; a string when the control plane refused. */
  error: string | null
}

export function useAlicornMembers(): AlicornMembersState {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Why optional: a render surface under test may not install window.api, and an older host
      // has no alicorn bridge at all — both degrade to "unreachable" rather than throwing.
      const list = window.api?.alicorn?.listMembers
      if (!list) {
        if (!cancelled) {
          setError('control_plane_unreachable')
        }
        return
      }
      const result = await list()
      if (cancelled) {
        return
      }
      if (result.ok) {
        setMembers(result.members)
      } else {
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { members, error }
}
