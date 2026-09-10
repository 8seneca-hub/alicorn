/**
 * The composer's Alicorn layer: who would build this, who would review it, and where it lands.
 *
 * Members and the org policy are read once per mount from the control plane. When it is not
 * configured the hook reports `available: false` and the composer renders nothing extra — a
 * developer with no control plane sees the workspace composer they have always seen, not an
 * empty Alicorn panel.
 *
 * `pinned` is what stops the plan arguing with the developer: the first override freezes it, and
 * the UI says so rather than silently continuing to rewrite the fields underneath.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Member, OrgPolicy } from '../../../shared/alicorn/members'
import {
  planTaskComposition,
  type ComposerRepoOption,
  type TaskComposerPlan
} from '../../../shared/alicorn/task-composer-plan'

export type ComposerTaskPlanState = {
  /** False while loading, and whenever the control plane has no members to plan with. */
  available: boolean
  members: Member[]
  plan: TaskComposerPlan | null
  pinned: boolean
  /** Overrides, once the developer has touched anything. Null means "follow the plan". */
  authorId: string | null
  reviewerId: string | null
  setAuthorId: (id: string) => void
  setReviewerId: (id: string) => void
  unpin: () => void
  memberName: (id: string) => string
}

type Options = {
  title: string
  brief: string
  repos: ComposerRepoOption[]
  openRepoId: string | null
}

export function useComposerTaskPlan(options: Options): ComposerTaskPlanState {
  const { title, brief, repos, openRepoId } = options
  const [members, setMembers] = useState<Member[]>([])
  const [orgPolicy, setOrgPolicy] = useState<OrgPolicy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [override, setOverride] = useState<{ authorId: string | null; reviewerId: string | null }>({
    authorId: null,
    reviewerId: null
  })

  useEffect(() => {
    let cancelled = false
    // The bridge is genuinely absent on hosts that predate it and in renderer tests that stub only
    // the api surface they use, and the composer has to keep working on both.
    const alicorn = window.api?.alicorn
    if (!alicorn) {
      setLoaded(true)
      return
    }
    void (async () => {
      const [memberResult, policyResult] = await Promise.all([
        alicorn.listMembers(),
        alicorn.getOrgPolicy()
      ]).catch(() => [null, null] as const)
      if (cancelled) {
        return
      }
      // A control plane that is not configured is not an error to show here — it is the pre-Alicorn
      // shape of this app, and the composer still has to work.
      setMembers(memberResult?.ok ? memberResult.members : [])
      setOrgPolicy(policyResult?.ok ? policyResult.policy : null)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const plan = useMemo(() => {
    if (!loaded || members.length === 0) {
      return null
    }
    return planTaskComposition({
      title,
      brief,
      members,
      repos,
      openRepoId,
      // No policy read means we cannot claim the org enforces the rule, so we do not flag it.
      orgPolicy: orgPolicy ?? { enforceDistinctReviewerBackend: false }
    })
  }, [loaded, members, title, brief, repos, openRepoId, orgPolicy])

  const memberName = useCallback(
    (id: string): string => members.find((member) => member.id === id)?.name ?? id,
    [members]
  )

  const setAuthorId = useCallback((id: string): void => {
    setOverride((current) => ({ ...current, authorId: id }))
  }, [])
  const setReviewerId = useCallback((id: string): void => {
    setOverride((current) => ({ ...current, reviewerId: id }))
  }, [])
  const unpin = useCallback((): void => {
    setOverride({ authorId: null, reviewerId: null })
  }, [])

  const pinned = override.authorId !== null || override.reviewerId !== null

  return {
    available: plan !== null,
    members,
    plan,
    pinned,
    authorId: override.authorId ?? plan?.authorId ?? null,
    reviewerId: override.reviewerId ?? plan?.reviewerId ?? null,
    setAuthorId,
    setReviewerId,
    unpin,
    memberName
  }
}
