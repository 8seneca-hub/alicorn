import { describe, expect, it } from 'vitest'
import type { Member, MemberBackend, MemberRole, OrgPolicy } from './members'
import { planTaskComposition, THIN_BRIEF_CHARS } from './task-composer-plan'

function member(id: string, role: MemberRole, backend: MemberBackend, name = id): Member {
  return {
    id,
    name,
    role,
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: [],
    tenantId: 'local',
    createdBy: 'test',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z'
  }
}

const ENFORCED: OrgPolicy = { enforceDistinctReviewerBackend: true }
const RELAXED: OrgPolicy = { enforceDistinctReviewerBackend: false }

const DEV = member('dev', 'developer', 'claude', 'Dev')
const REVIEWER_GROK = member('qa', 'reviewer', 'grok', 'QA')
const REVIEWER_CLAUDE = member('qa2', 'reviewer', 'claude', 'QA Claude')

const REPOS = [
  { id: 'r1', name: 'payments-service' },
  { id: 'r2', name: 'notifications-worker' }
]

const base = {
  title: '',
  brief: '',
  members: [DEV, REVIEWER_GROK],
  repos: REPOS,
  orgPolicy: ENFORCED
}

describe('planTaskComposition — repositories', () => {
  it('matches a repository named in the brief', () => {
    const plan = planTaskComposition({
      ...base,
      title: 'Partial refunds',
      brief: 'Change the payments handler so a partial amount writes its own ledger entry.'
    })
    expect(plan.repoIds).toEqual(['r1'])
    expect(plan.reasons).toContainEqual({
      kind: 'repo_matched',
      repoIds: ['r1']
    })
  })

  it('matches every repository the text names, which is how a multi-repo task starts', () => {
    const plan = planTaskComposition({
      ...base,
      title: 'Idempotency rollout',
      brief: 'Header handling in payments, dedupe in the notifications consumer.'
    })
    expect(plan.repoIds).toEqual(['r1', 'r2'])
  })

  // A token this short matches half the workspace; matching on it is not evidence.
  it('ignores tokens too short to be evidence', () => {
    const plan = planTaskComposition({
      ...base,
      repos: [{ id: 'r3', name: 'api' }, ...REPOS],
      title: 'Rework the api surface',
      brief: 'No repository is genuinely named here.'
    })
    expect(plan.repoIds).not.toContain('r3')
  })

  it('resolves silently when the workspace holds exactly one repository', () => {
    const plan = planTaskComposition({
      ...base,
      repos: [REPOS[0]],
      title: 'Anything at all',
      brief: 'Nothing here names the repository by any of its tokens.'
    })
    expect(plan.repoIds).toEqual(['r1'])
    expect(plan.reasons).toContainEqual({
      kind: 'repo_only_one',
      repoId: 'r1'
    })
  })

  // The weak case has to announce itself, or the developer cannot tell a match from a shrug.
  it('falls back to the open repository and says that is what it did', () => {
    const plan = planTaskComposition({
      ...base,
      openRepoId: 'r2',
      title: 'Something vague',
      brief: 'Nothing here names a repository.'
    })
    expect(plan.repoIds).toEqual(['r2'])
    expect(plan.reasons).toContainEqual({
      kind: 'repo_defaulted_to_open',
      repoId: 'r2'
    })
  })

  it('leaves the repository unresolved rather than picking one arbitrarily', () => {
    const plan = planTaskComposition({
      ...base,
      title: 'Something vague',
      brief: 'Nothing here names a repository and nothing is open.'
    })
    expect(plan.repoIds).toEqual([])
    expect(plan.reasons).toContainEqual({ kind: 'repo_unresolved' })
  })
})

describe('planTaskComposition — members', () => {
  it('picks the developer named in the brief over the first one', () => {
    const other = member('dev2', 'developer', 'codex', 'Codex Dev')
    const plan = planTaskComposition({
      ...base,
      members: [DEV, other, REVIEWER_GROK],
      title: 'Have Codex Dev take the worker consumer',
      brief: 'It is mostly mechanical.'
    })
    expect(plan.authorId).toBe('dev2')
    expect(plan.reasons).toContainEqual({
      kind: 'author_named_in_brief',
      memberId: 'dev2'
    })
  })

  it('prefers a reviewer on a different backend from the author', () => {
    const plan = planTaskComposition({
      ...base,
      members: [DEV, REVIEWER_CLAUDE, REVIEWER_GROK],
      title: 'Partial refunds in payments',
      brief: 'A reviewer must not share the author backend.'
    })
    expect(plan.reviewerId).toBe('qa')
    expect(plan.reviewerConflict).toBe(false)
    expect(plan.reasons).toContainEqual({
      kind: 'reviewer_distinct_backend',
      memberId: 'qa',
      backend: 'grok'
    })
  })

  it('flags a conflict when every reviewer shares the author backend and the org enforces it', () => {
    const plan = planTaskComposition({
      ...base,
      members: [DEV, REVIEWER_CLAUDE],
      title: 'Partial refunds in payments',
      brief: 'Only a claude reviewer exists, and the author is on claude.'
    })
    expect(plan.reviewerId).toBe('qa2')
    expect(plan.reviewerConflict).toBe(true)
    expect(plan.reasons).toContainEqual({
      kind: 'reviewer_shares_author_backend',
      memberId: 'qa2',
      backend: 'claude'
    })
  })

  // The rule is the org's. With it off, a shared backend is a fact, not a problem.
  it('does not flag a conflict when the org does not enforce distinct backends', () => {
    const plan = planTaskComposition({
      ...base,
      members: [DEV, REVIEWER_CLAUDE],
      orgPolicy: RELAXED,
      title: 'Partial refunds in payments',
      brief: 'The org has opted out of the reviewer-backend rule.'
    })
    expect(plan.reviewerConflict).toBe(false)
  })

  it('falls back to a qa member when no reviewer role exists', () => {
    const qa = member('qa3', 'qa', 'grok', 'QA Only')
    const plan = planTaskComposition({
      ...base,
      members: [DEV, qa],
      title: 'Partial refunds in payments',
      brief: 'Only a qa member is available to review.'
    })
    expect(plan.reviewerId).toBe('qa3')
  })

  it('reports rather than invents when nobody can author or review', () => {
    const plan = planTaskComposition({
      ...base,
      members: [member('an', 'analyst', 'claude', 'Analyst')],
      title: 'Partial refunds in payments',
      brief: 'The org library has nobody who builds or reviews.'
    })
    expect(plan.authorId).toBeNull()
    expect(plan.reviewerId).toBeNull()
    expect(plan.reasons).toContainEqual({ kind: 'no_author_available' })
    expect(plan.reasons).toContainEqual({ kind: 'no_reviewer_available' })
  })
})

describe('planTaskComposition — brief', () => {
  it('hints when the brief is too thin to build from', () => {
    const plan = planTaskComposition({
      ...base,
      title: 'fix refunds',
      brief: ''
    })
    expect(plan.reasons).toContainEqual({ kind: 'brief_thin' })
  })

  it('stays quiet once there is enough context', () => {
    const brief = 'x'.repeat(THIN_BRIEF_CHARS)
    const plan = planTaskComposition({
      ...base,
      title: 'Partial refunds',
      brief
    })
    expect(plan.reasons).not.toContainEqual({ kind: 'brief_thin' })
  })
})
