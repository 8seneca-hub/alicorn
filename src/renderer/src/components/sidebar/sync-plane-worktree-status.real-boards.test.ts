import { describe, expect, it, vi } from 'vitest'
import type { PlaneState } from '../../../../shared/plane-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../shared/worktree/types'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../shared/workspace-status-defaults'
import { syncPlaneWorktreeStatus } from './sync-plane-worktree-status'

// Fixtures copied from two live boards on projects.8seneca.com (2026-09-07), because every other
// test in this area uses states we invented — and the shapes we invented were tidier than the real
// ones. `8HUB` is the team's actual delivery workflow; `ALC` is this project's own board.
//
// What the real data changes: 8HUB has *three* `started` states and *two* `completed` states, so
// the group alone decides almost nothing and the within-group name match carries the mapping.
const HUB_STATES: PlaneState[] = [
  { id: 's-backlog', name: 'Backlog', color: '#60646C', group: 'backlog', isDefault: true },
  { id: 's-todo', name: 'Todo', color: '#60646C', group: 'unstarted', isDefault: false },
  { id: 's-progress', name: 'In Progress', color: '#F59E0B', group: 'started', isDefault: false },
  { id: 's-review', name: 'In Review', color: '#8B5CF6', group: 'started', isDefault: false },
  { id: 's-testing', name: 'Testing on Dev', color: '#0EA5E9', group: 'started', isDefault: false },
  { id: 's-ready', name: 'Ready for Prod', color: '#65A30D', group: 'completed', isDefault: false },
  { id: 's-done', name: 'Done', color: '#46A758', group: 'completed', isDefault: false },
  { id: 's-cancelled', name: 'Cancelled', color: '#9AA4BC', group: 'cancelled', isDefault: false }
]

// The Alicorn board is Plane's default set: no review state at all.
const ALC_STATES: PlaneState[] = [
  { id: 'a-backlog', name: 'Backlog', color: '#60646C', group: 'backlog', isDefault: true },
  { id: 'a-todo', name: 'Todo', color: '#60646C', group: 'unstarted', isDefault: false },
  { id: 'a-progress', name: 'In Progress', color: '#F59E0B', group: 'started', isDefault: false },
  { id: 'a-done', name: 'Done', color: '#46A758', group: 'completed', isDefault: false },
  { id: 'a-cancelled', name: 'Cancelled', color: '#9AA4BC', group: 'cancelled', isDefault: false }
]

const worktree = {
  id: 'wt1',
  linkedPlaneIssue: 'issue-1',
  linkedPlaneProjectId: 'project-1'
} as Worktree

function column(id: string): WorkspaceStatusDefinition {
  const found = DEFAULT_WORKSPACE_STATUSES.find((status) => status.id === id)
  if (!found) {
    throw new Error(`no default board column ${id}`)
  }
  return found
}

async function move(states: readonly PlaneState[], columnId: string) {
  const updateIssueState = vi.fn(async (_worktree: unknown, _stateId: string) => {})
  const outcome = await syncPlaneWorktreeStatus({
    worktree,
    targetStatus: column(columnId),
    states,
    currentStateId: null,
    getLatestWorkspaceStatus: () => columnId,
    updateIssueState
  })
  const stateId = updateIssueState.mock.calls[0]?.[1]
  return { outcome, stateId }
}

describe('board columns against the 8HUB workflow', () => {
  it('sends Todo to the one unstarted state', async () => {
    await expect(move(HUB_STATES, 'todo')).resolves.toEqual({
      outcome: 'updated',
      stateId: 's-todo'
    })
  })

  // Three started states, two of which are not "In Progress" — the group cannot decide this, so the
  // within-group label match is what resolves it.
  it('sends In progress to In Progress, not to Testing on Dev', async () => {
    await expect(move(HUB_STATES, 'in-progress')).resolves.toEqual({
      outcome: 'updated',
      stateId: 's-progress'
    })
  })

  it('sends In review to In Review', async () => {
    await expect(move(HUB_STATES, 'in-review')).resolves.toEqual({
      outcome: 'updated',
      stateId: 's-review'
    })
  })

  // Two completed states: "Ready for Prod" is the team's first closed state and "Done" is terminal.
  // Moving a card to the board's Done column must not silently mark it Ready for Prod.
  it('sends Done to Done, not to the other completed state', async () => {
    await expect(move(HUB_STATES, 'completed')).resolves.toEqual({
      outcome: 'updated',
      stateId: 's-done'
    })
  })
})

describe('board columns against the Alicorn board', () => {
  it.each([
    ['todo', 'a-todo'],
    ['in-progress', 'a-progress'],
    ['completed', 'a-done']
  ])('sends %s to %s', async (columnId, stateId) => {
    await expect(move(ALC_STATES, columnId)).resolves.toEqual({ outcome: 'updated', stateId })
  })

  // This board has no review state, so the review column resolves to nothing and writes nothing.
  // Documented behaviour rather than a defect — but it fires on this repo's own board, so it is
  // pinned here so nobody "fixes" it by guessing a started state.
  it('refuses to invent a review state that the board does not have', async () => {
    const updateIssueState = vi.fn(async (_worktree: unknown, _stateId: string) => {})
    const outcome = await syncPlaneWorktreeStatus({
      worktree,
      targetStatus: column('in-review'),
      states: ALC_STATES,
      currentStateId: null,
      getLatestWorkspaceStatus: () => 'in-review',
      updateIssueState
    })
    expect(outcome).toBe('ambiguous')
    expect(updateIssueState).not.toHaveBeenCalled()
  })
})
