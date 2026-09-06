import {
  planeGetIssue,
  planeListStates,
  planeUpdateIssueState,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import type {
  PlaneIssue,
  PlaneResult,
  PlaneState,
  PlaneStateGroup
} from '../../../../shared/plane-types'
import type {
  WorkspaceStatus,
  WorkspaceStatusDefinition,
  Worktree
} from '../../../../shared/worktree/types'

export type PlaneWorktreeStatusSyncOutcome =
  | 'updated'
  | 'already'
  | 'ambiguous'
  | 'stale'
  | 'skipped'

export type SyncPlaneWorktreeStatusArgs = {
  worktree: Pick<Worktree, 'id' | 'linkedPlaneIssue' | 'linkedPlaneProjectId'>
  targetStatus: WorkspaceStatusDefinition
  states: readonly PlaneState[]
  /** State the issue is in now, when the caller already read it; skips a redundant write. */
  currentStateId: string | null
  getLatestWorkspaceStatus: (worktreeId: string) => WorkspaceStatus | null | undefined
  updateIssueState: (
    worktree: Pick<Worktree, 'id' | 'linkedPlaneIssue' | 'linkedPlaneProjectId'>,
    stateId: string
  ) => Promise<void>
}

// The default board columns map onto Plane's state groups. `in-progress` and `in-review` are both
// group `started`, so the group alone cannot separate them — the review column additionally
// requires the state to read as a review.
const GROUP_BY_STATUS: Record<string, PlaneStateGroup> = {
  todo: 'unstarted',
  'in-progress': 'started',
  'in-review': 'started',
  completed: 'completed'
}

const REVIEW_NAME = /review/i

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function candidatesByGroup(
  states: readonly PlaneState[],
  targetStatus: WorkspaceStatusDefinition
): PlaneState[] {
  const group = GROUP_BY_STATUS[targetStatus.id]
  if (!group) {
    return []
  }
  const inGroup = states.filter((state) => state.group === group)
  if (targetStatus.id === 'in-review') {
    return inGroup.filter((state) => REVIEW_NAME.test(state.name))
  }
  if (targetStatus.id === 'in-progress') {
    // Why: without this the review state is a second candidate for in-progress and every move
    // would read as ambiguous on a board that has both.
    return inGroup.filter((state) => !REVIEW_NAME.test(state.name))
  }
  return inGroup
}

function candidatesByName(
  states: readonly PlaneState[],
  targetStatus: WorkspaceStatusDefinition
): PlaneState[] {
  const target = normalizeName(targetStatus.label)
  return states.filter((state) => normalizeName(state.name) === target)
}

/**
 * Writes a board column back to the Plane issue's state.
 *
 * Never guesses: zero or several candidate states both resolve to `ambiguous` and no write happens.
 * Guessing here would move a real issue on someone else's board, which is worse than doing nothing
 * and is not something the user can see to undo.
 */
export async function syncPlaneWorktreeStatus(
  args: SyncPlaneWorktreeStatusArgs
): Promise<PlaneWorktreeStatusSyncOutcome> {
  const { worktree, targetStatus, states } = args
  if (!worktree.linkedPlaneIssue || !worktree.linkedPlaneProjectId) {
    return 'skipped'
  }

  // Group first. When the group leaves several candidates, an exact column-label match narrows
  // *within* the group — that is a precise match, not a guess. A name match is only allowed to
  // range over every state when the group matched nothing at all (a custom column).
  const byGroup = candidatesByGroup(states, targetStatus)
  const matches =
    byGroup.length === 1
      ? byGroup
      : byGroup.length > 1
        ? candidatesByName(byGroup, targetStatus)
        : candidatesByName(states, targetStatus)
  if (matches.length !== 1) {
    return 'ambiguous'
  }

  const [target] = matches
  if (args.currentStateId === target!.id) {
    return 'already'
  }

  // Why: board moves are local-first and the provider round-trip is slow; re-check immediately
  // before writing so an older move cannot overwrite a newer one in Plane.
  if (args.getLatestWorkspaceStatus(worktree.id) !== targetStatus.id) {
    return 'stale'
  }

  await args.updateIssueState(worktree, target!.id)
  return 'updated'
}

type PlaneBoardWriteDeps = {
  getIssue: (
    settings: RuntimePlaneSettings,
    args: { projectId: string; issueId: string }
  ) => Promise<PlaneResult<PlaneIssue | null>>
  listStates: (
    settings: RuntimePlaneSettings,
    args: { projectId: string }
  ) => Promise<PlaneResult<PlaneState[]>>
  updateIssueState: (
    settings: RuntimePlaneSettings,
    args: { projectId: string; issueId: string; stateId: string }
  ) => Promise<PlaneResult<PlaneIssue | null>>
}

export type PlaneBoardWriteResult =
  | { outcome: PlaneWorktreeStatusSyncOutcome }
  | { outcome: 'failed'; detail: string }

const defaultPlaneBoardWriteDeps: PlaneBoardWriteDeps = {
  getIssue: planeGetIssue,
  listStates: planeListStates,
  updateIssueState: planeUpdateIssueState
}

/**
 * The IO half: reads the issue and the project's states, then defers the decision to the pure
 * mapper above. Separated so the mapping rules are testable without a provider.
 */
export async function runPlaneWorktreeStatusSync(args: {
  worktree: Pick<Worktree, 'id' | 'linkedPlaneIssue' | 'linkedPlaneProjectId'>
  targetStatus: WorkspaceStatusDefinition
  settings: RuntimePlaneSettings
  getLatestWorkspaceStatus: (worktreeId: string) => WorkspaceStatus | null | undefined
  deps?: Partial<PlaneBoardWriteDeps>
}): Promise<PlaneBoardWriteResult> {
  const { worktree, settings } = args
  const projectId = worktree.linkedPlaneProjectId
  const issueId = worktree.linkedPlaneIssue
  if (!projectId || !issueId) {
    return { outcome: 'skipped' }
  }
  const deps = { ...defaultPlaneBoardWriteDeps, ...args.deps }

  const issue = await deps.getIssue(settings, { projectId, issueId })
  if (issue.ok === false) {
    return { outcome: 'failed', detail: issue.error }
  }
  const states = await deps.listStates(settings, { projectId })
  if (states.ok === false) {
    return { outcome: 'failed', detail: states.error }
  }

  let writeError: string | null = null
  const outcome = await syncPlaneWorktreeStatus({
    worktree,
    targetStatus: args.targetStatus,
    states: states.value,
    currentStateId: issue.value?.stateId ?? null,
    getLatestWorkspaceStatus: args.getLatestWorkspaceStatus,
    updateIssueState: async (_worktree, stateId) => {
      const written = await deps.updateIssueState(settings, { projectId, issueId, stateId })
      if (written.ok === false) {
        writeError = written.error
      }
    }
  })
  if (writeError !== null) {
    return { outcome: 'failed', detail: writeError }
  }
  return { outcome }
}
