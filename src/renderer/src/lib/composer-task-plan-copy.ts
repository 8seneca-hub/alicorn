/**
 * Turns the planner's structured reasons into one sentence each.
 *
 * The planner deliberately returns `{ kind, … }` rather than prose so that these strings live in
 * the renderer, where the localisation tooling can find them. Names are resolved here too: the
 * planner carries ids, because a member rename must not invalidate a decision it already made.
 */
import type { TaskComposerReason } from '../../../shared/alicorn/task-composer-plan'
import { translate } from '@/i18n/i18n'

export type PlanNameLookup = {
  memberName: (id: string) => string
  repoName: (id: string) => string
}

/** Reasons the developer must act on, rendered as a warning rather than an explanation. */
const BLOCKING_KINDS = new Set<TaskComposerReason['kind']>([
  'repo_unresolved',
  'no_author_available',
  'no_reviewer_available',
  'reviewer_shares_author_backend'
])

export function isBlockingPlanReason(reason: TaskComposerReason): boolean {
  return BLOCKING_KINDS.has(reason.kind)
}

export function describePlanReason(reason: TaskComposerReason, names: PlanNameLookup): string {
  switch (reason.kind) {
    case 'repo_matched':
      return translate(
        'auto.components.composerTaskPlan.repoMatched',
        'Matched {{repos}} from what you wrote',
        { repos: reason.repoIds.map(names.repoName).join(' and ') }
      )
    case 'repo_only_one':
      return translate(
        'auto.components.composerTaskPlan.repoOnlyOne',
        '{{repo}} is the only repository here',
        { repo: names.repoName(reason.repoId) }
      )
    case 'repo_defaulted_to_open':
      return translate(
        'auto.components.composerTaskPlan.repoDefaultedToOpen',
        'Defaulted to {{repo}} — nothing you wrote named a repository',
        { repo: names.repoName(reason.repoId) }
      )
    case 'repo_unresolved':
      return translate(
        'auto.components.composerTaskPlan.repoUnresolved',
        'No repository matched — choose one before starting'
      )
    case 'author_named_in_brief':
      return translate(
        'auto.components.composerTaskPlan.authorNamed',
        'You named {{member}}, so they build it',
        { member: names.memberName(reason.memberId) }
      )
    case 'author_defaulted':
      return translate('auto.components.composerTaskPlan.authorDefaulted', '{{member}} builds it', {
        member: names.memberName(reason.memberId)
      })
    case 'no_author_available':
      return translate(
        'auto.components.composerTaskPlan.noAuthor',
        'No member has the developer role, so nobody can build this yet'
      )
    case 'reviewer_distinct_backend':
      return translate(
        'auto.components.composerTaskPlan.reviewerDistinct',
        '{{member}} reviews on {{backend}}, a different backend from the author',
        { member: names.memberName(reason.memberId), backend: reason.backend }
      )
    case 'reviewer_shares_author_backend':
      return translate(
        'auto.components.composerTaskPlan.reviewerShared',
        '{{member}} reviews on {{backend}} — the author’s own backend, so this gates at review',
        { member: names.memberName(reason.memberId), backend: reason.backend }
      )
    case 'no_reviewer_available':
      return translate(
        'auto.components.composerTaskPlan.noReviewer',
        'No member can review, so this gates at review'
      )
    case 'brief_thin':
      return translate(
        'auto.components.composerTaskPlan.briefThin',
        'Add a sentence of context — it is cheaper than a wrong build'
      )
  }
}
