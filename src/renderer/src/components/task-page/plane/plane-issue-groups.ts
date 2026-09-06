import {
  PLANE_STATE_GROUPS,
  type PlaneIssue,
  type PlaneState,
  type PlaneStateGroup
} from '../../../../../shared/plane-types'

export type PlaneIssueGroup = {
  state: PlaneState
  issues: PlaneIssue[]
}

// Plane orders states by `sequence` within a project, but the group order is
// the one a reader expects: work in flight above work not started.
const GROUP_ORDER = new Map<PlaneStateGroup, number>(
  PLANE_STATE_GROUPS.map((group, index) => [group, index])
)

function groupRank(state: PlaneState): number {
  return GROUP_ORDER.get(state.group) ?? PLANE_STATE_GROUPS.length
}

/**
 * Issues bucketed by their state, in state order.
 *
 * An issue whose state is not in the project's list is dropped rather than
 * shown ungrouped: Plane excludes triage states from the states endpoint, so an
 * unmatched state means the issue is not one this view is meant to show.
 */
export function groupPlaneIssuesByState(
  issues: readonly PlaneIssue[],
  states: readonly PlaneState[]
): PlaneIssueGroup[] {
  const byState = new Map<string, PlaneIssue[]>()
  for (const issue of issues) {
    if (!issue.stateId) {
      continue
    }
    const bucket = byState.get(issue.stateId)
    if (bucket) {
      bucket.push(issue)
      continue
    }
    byState.set(issue.stateId, [issue])
  }
  return [...states]
    .sort((left, right) => groupRank(left) - groupRank(right))
    .map((state) => ({ state, issues: byState.get(state.id) ?? [] }))
    .filter((group) => group.issues.length > 0)
}

/** Client-side, because Plane's v1 list endpoint has no server-side filtering. */
export function filterPlaneIssues(issues: readonly PlaneIssue[], query: string): PlaneIssue[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return [...issues]
  }
  return issues.filter(
    (issue) =>
      issue.name.toLowerCase().includes(needle) || issue.readableId.toLowerCase().includes(needle)
  )
}
