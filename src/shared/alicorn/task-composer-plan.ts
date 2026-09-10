/**
 * What the composer proposes when a developer has typed a title and a sentence of context.
 *
 * The whole point is that starting a task costs two fields, so this module answers the rest —
 * which member authors it, who reviews it, which repository it lands in — and says why for each.
 * Two rules keep it honest. It never guesses: where nothing resolves it returns the unresolved
 * reason and leaves the field to the human. And it returns *reasons*, not sentences, because the
 * renderer localises its own strings and an English clause baked in here could never be translated.
 *
 * The reviewer rule is the org's (`enforceDistinctReviewerBackend`), not this module's opinion —
 * a member may not loosen the criteria that judge it, and that includes by way of the composer.
 */
import type { Member, MemberBackend, OrgPolicy } from './members'

/** Under this many characters of title plus brief, the UI suggests another sentence. */
export const THIN_BRIEF_CHARS = 60

/** Repo-name tokens shorter than this match too much to be evidence of anything. */
const MIN_MATCH_TOKEN = 4

export type ComposerRepoOption = {
  id: string
  name: string
}

export type TaskComposerInput = {
  title: string
  brief: string
  members: Member[]
  repos: ComposerRepoOption[]
  orgPolicy: OrgPolicy
  /** The repository the composer already has open. Used only when nothing matches, and said out loud. */
  openRepoId?: string | null
}

export type TaskComposerReason =
  | { kind: 'repo_matched'; repoIds: string[] }
  | { kind: 'repo_only_one'; repoId: string }
  | { kind: 'repo_defaulted_to_open'; repoId: string }
  | { kind: 'repo_unresolved' }
  | { kind: 'author_named_in_brief'; memberId: string }
  | { kind: 'author_defaulted'; memberId: string }
  | { kind: 'no_author_available' }
  | {
      kind: 'reviewer_distinct_backend'
      memberId: string
      backend: MemberBackend
    }
  | {
      kind: 'reviewer_shares_author_backend'
      memberId: string
      backend: MemberBackend
    }
  | { kind: 'no_reviewer_available' }
  | { kind: 'brief_thin' }

export type TaskComposerPlan = {
  authorId: string | null
  reviewerId: string | null
  repoIds: string[]
  /** In the order the decisions were made, so the UI can render them as one sentence. */
  reasons: TaskComposerReason[]
  /**
   * The reviewer runs on the author's backend *and* the org enforces distinct backends — the task
   * would gate at review. Only ever true when the org actually enforces it.
   */
  reviewerConflict: boolean
}

function normalise(text: string): string {
  return text.toLowerCase()
}

/** Tokens worth matching on: a repo called `payments-service` matches "payments", not "api". */
function repoTokens(name: string): string[] {
  return normalise(name)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_MATCH_TOKEN)
}

function matchRepos(repos: ComposerRepoOption[], text: string): ComposerRepoOption[] {
  const haystack = normalise(text)
  return repos.filter((repo) => repoTokens(repo.name).some((token) => haystack.includes(token)))
}

function resolveRepos(
  input: TaskComposerInput,
  text: string
): { repoIds: string[]; reason: TaskComposerReason } {
  const matched = matchRepos(input.repos, text)
  if (matched.length > 0) {
    const repoIds = matched.map((repo) => repo.id)
    return { repoIds, reason: { kind: 'repo_matched', repoIds } }
  }
  if (input.repos.length === 1) {
    const repoId = input.repos[0].id
    return { repoIds: [repoId], reason: { kind: 'repo_only_one', repoId } }
  }
  const open = input.repos.find((repo) => repo.id === input.openRepoId)
  if (open) {
    // Weak, so it is stated: several repositories and nothing in the text picked between them.
    return {
      repoIds: [open.id],
      reason: { kind: 'repo_defaulted_to_open', repoId: open.id }
    }
  }
  return { repoIds: [], reason: { kind: 'repo_unresolved' } }
}

function pickAuthor(
  members: Member[],
  text: string
): { author: Member | null; reason: TaskComposerReason } {
  const developers = members.filter((member) => member.role === 'developer')
  if (developers.length === 0) {
    return { author: null, reason: { kind: 'no_author_available' } }
  }
  const haystack = normalise(text)
  // Longest name first: a member called "Dev" is a substring of "Codex Dev", and the short one
  // would otherwise claim every mention of the long one.
  const named = [...developers]
    .sort((a, b) => b.name.length - a.name.length)
    .find((member) => haystack.includes(normalise(member.name)))
  if (named) {
    return {
      author: named,
      reason: { kind: 'author_named_in_brief', memberId: named.id }
    }
  }
  return {
    author: developers[0],
    reason: { kind: 'author_defaulted', memberId: developers[0].id }
  }
}

/** Reviewers first, QA second — both review, but a dedicated reviewer is the stronger signal. */
function reviewerCandidates(members: Member[]): Member[] {
  return [
    ...members.filter((member) => member.role === 'reviewer'),
    ...members.filter((member) => member.role === 'qa')
  ]
}

function pickReviewer(
  members: Member[],
  author: Member | null,
  orgPolicy: OrgPolicy
): { reviewer: Member | null; reason: TaskComposerReason; conflict: boolean } {
  const candidates = reviewerCandidates(members)
  if (candidates.length === 0) {
    return {
      reviewer: null,
      reason: { kind: 'no_reviewer_available' },
      conflict: false
    }
  }
  const distinct = author
    ? candidates.find((member) => member.backend !== author.backend)
    : candidates[0]
  if (distinct) {
    return {
      reviewer: distinct,
      reason: {
        kind: 'reviewer_distinct_backend',
        memberId: distinct.id,
        backend: distinct.backend
      },
      conflict: false
    }
  }
  // Everyone who could review runs what the author runs. Say so; the org decides if it blocks.
  const fallback = candidates[0]
  return {
    reviewer: fallback,
    reason: {
      kind: 'reviewer_shares_author_backend',
      memberId: fallback.id,
      backend: fallback.backend
    },
    conflict: orgPolicy.enforceDistinctReviewerBackend
  }
}

export function planTaskComposition(input: TaskComposerInput): TaskComposerPlan {
  const text = `${input.title} ${input.brief}`
  const reasons: TaskComposerReason[] = []

  const repos = resolveRepos(input, text)
  reasons.push(repos.reason)

  const { author, reason: authorReason } = pickAuthor(input.members, text)
  reasons.push(authorReason)

  const reviewer = pickReviewer(input.members, author, input.orgPolicy)
  reasons.push(reviewer.reason)

  if (text.trim().length < THIN_BRIEF_CHARS) {
    reasons.push({ kind: 'brief_thin' })
  }

  return {
    authorId: author?.id ?? null,
    reviewerId: reviewer.reviewer?.id ?? null,
    repoIds: repos.repoIds,
    reasons,
    reviewerConflict: reviewer.conflict
  }
}
