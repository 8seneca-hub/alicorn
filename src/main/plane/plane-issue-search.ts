import type { PlaneIssue, PlaneState, PlaneStateGroup } from '../../shared/plane-types'

export type PlaneIssueSearchFilters = {
  /** Matches the state's group, not its user-editable name. */
  stateGroup?: PlaneStateGroup
  /** Case-insensitive substring of the issue name or its readable id. */
  query?: string
  limit?: number
}

// Plane CE has no server-side issue filtering, so the project's issues are
// fetched once and narrowed here rather than by query parameters the server
// would silently ignore.
export function filterPlaneIssues(
  issues: readonly PlaneIssue[],
  states: readonly PlaneState[],
  filters: PlaneIssueSearchFilters
): PlaneIssue[] {
  const groupByStateId = new Map(states.map((state) => [state.id, state.group]))
  const query = filters.query?.trim().toLowerCase()
  const matched = issues.filter((issue) => {
    if (filters.stateGroup) {
      const group = issue.stateId ? groupByStateId.get(issue.stateId) : undefined
      if (group !== filters.stateGroup) {
        return false
      }
    }
    if (!query) {
      return true
    }
    return (
      issue.name.toLowerCase().includes(query) || issue.readableId.toLowerCase().includes(query)
    )
  })
  return filters.limit !== undefined ? matched.slice(0, filters.limit) : matched
}

export function resolveStateByName(
  states: readonly PlaneState[],
  name: string
): { state: PlaneState } | { candidates: PlaneState[] } {
  const wanted = name.trim().toLowerCase()
  const exact = states.filter((state) => state.name.trim().toLowerCase() === wanted)
  if (exact.length === 1) {
    return { state: exact[0] }
  }
  if (exact.length > 1) {
    return { candidates: exact }
  }
  // A unique prefix is enough to name a state at a prompt; anything less
  // specific returns the candidates so the caller can list them.
  const prefix = states.filter((state) => state.name.trim().toLowerCase().startsWith(wanted))
  return prefix.length === 1 ? { state: prefix[0] } : { candidates: prefix }
}
