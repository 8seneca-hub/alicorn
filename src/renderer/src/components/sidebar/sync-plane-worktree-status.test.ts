import { describe, expect, it, vi } from 'vitest'
import type { PlaneIssue, PlaneState } from '../../../../shared/plane-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../shared/worktree/types'
import { runPlaneWorktreeStatusSync, syncPlaneWorktreeStatus } from './sync-plane-worktree-status'

function state(id: string, name: string, group: PlaneState['group']): PlaneState {
  return { id, name, color: '#000', group, isDefault: false }
}

const STATES: PlaneState[] = [
  state('s-backlog', 'Backlog', 'backlog'),
  state('s-todo', 'Todo', 'unstarted'),
  state('s-progress', 'In Progress', 'started'),
  state('s-review', 'In Review', 'started'),
  state('s-done', 'Done', 'completed'),
  state('s-cancelled', 'Cancelled', 'cancelled')
]

// The write path only reads `stateId`, but the dep is typed to the whole issue —
// a partial stand-in makes the fixture's cast non-comparable and fails tc.
function issue(stateId: string): PlaneIssue {
  return {
    id: 'issue-1',
    sequenceId: 11,
    readableId: 'ALC-11',
    name: 'Sync the board',
    descriptionHtml: '',
    priority: 'none',
    stateId,
    projectId: 'project-1',
    assigneeIds: [],
    labelIds: [],
    parentId: null,
    startDate: null,
    targetDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    isDraft: false
  }
}

const worktree = {
  id: 'wt1',
  linkedPlaneIssue: 'issue-1',
  linkedPlaneProjectId: 'project-1'
} as Worktree

function status(id: string, label: string): WorkspaceStatusDefinition {
  return { id, label }
}

function run(
  targetStatus: WorkspaceStatusDefinition,
  overrides: Partial<Parameters<typeof syncPlaneWorktreeStatus>[0]> = {}
) {
  return syncPlaneWorktreeStatus({
    worktree,
    targetStatus,
    states: STATES,
    currentStateId: null,
    getLatestWorkspaceStatus: () => targetStatus.id,
    updateIssueState: vi.fn(async () => {}),
    ...overrides
  })
}

describe('syncPlaneWorktreeStatus', () => {
  it('maps in-review to a started state whose name reads as review', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), { updateIssueState })

    expect(outcome).toBe('updated')
    expect(updateIssueState).toHaveBeenCalledWith(worktree, 's-review')
  })

  // Why: `in-progress` and `in-review` are both Plane group `started`, so group alone is ambiguous.
  // In-progress must not land on the review state.
  it('keeps in-progress off the review state', async () => {
    const updateIssueState = vi.fn(async () => {})
    await run(status('in-progress', 'In progress'), { updateIssueState })

    expect(updateIssueState).toHaveBeenCalledWith(worktree, 's-progress')
  })

  it('maps todo to unstarted and completed to completed', async () => {
    const todo = vi.fn(async () => {})
    await run(status('todo', 'Todo'), { updateIssueState: todo })
    expect(todo).toHaveBeenCalledWith(worktree, 's-todo')

    const done = vi.fn(async () => {})
    await run(status('completed', 'Done'), { updateIssueState: done })
    expect(done).toHaveBeenCalledWith(worktree, 's-done')
  })

  // Why: a custom board column has no group to match on, so a unique name match is the fallback.
  it('falls back to a unique name match for a custom column', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('cancelled', 'Cancelled'), { updateIssueState })

    expect(outcome).toBe('updated')
    expect(updateIssueState).toHaveBeenCalledWith(worktree, 's-cancelled')
  })

  // Why: an exact column-label match inside the group is a precise match, not a guess, so a board
  // carrying both "In Review" and "Peer Review" still resolves.
  it('narrows two group candidates by an exact label match', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), {
      states: [
        state('s-review-1', 'In Review', 'started'),
        state('s-review-2', 'Peer Review', 'started')
      ],
      updateIssueState
    })

    expect(outcome).toBe('updated')
    expect(updateIssueState).toHaveBeenCalledWith(worktree, 's-review-1')
  })

  it('reports ambiguous when several candidates remain and none matches the label', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), {
      states: [
        state('s-review-1', 'Code Review', 'started'),
        state('s-review-2', 'Peer Review', 'started')
      ],
      updateIssueState
    })

    expect(outcome).toBe('ambiguous')
    expect(updateIssueState).not.toHaveBeenCalled()
  })

  it('reports ambiguous rather than guessing when nothing matches', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('archived', 'Archived'), {
      states: [state('s-todo', 'Todo', 'unstarted')],
      updateIssueState
    })

    expect(outcome).toBe('ambiguous')
    expect(updateIssueState).not.toHaveBeenCalled()
  })

  // Why: board moves are local-first and the provider round-trip is slow. An older move must never
  // overwrite a newer one — the same guard Linear's sync applies.
  it('does not write when the board moved on while the read was in flight', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), {
      getLatestWorkspaceStatus: () => 'completed',
      updateIssueState
    })

    expect(outcome).toBe('stale')
    expect(updateIssueState).not.toHaveBeenCalled()
  })

  it('skips the write when the issue already holds the target state', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), {
      currentStateId: 's-review',
      updateIssueState
    })

    expect(outcome).toBe('already')
    expect(updateIssueState).not.toHaveBeenCalled()
  })

  it('skips a worktree with no linked Plane issue', async () => {
    const updateIssueState = vi.fn(async () => {})
    const outcome = await run(status('in-review', 'In review'), {
      worktree: { id: 'wt2' } as Worktree,
      updateIssueState
    })

    expect(outcome).toBe('skipped')
    expect(updateIssueState).not.toHaveBeenCalled()
  })
})

describe('runPlaneWorktreeStatusSync', () => {
  const settings = {} as Parameters<typeof runPlaneWorktreeStatusSync>[0]['settings']

  function io(overrides: Record<string, unknown> = {}) {
    return {
      worktree,
      targetStatus: status('in-review', 'In review'),
      settings,
      getLatestWorkspaceStatus: () => 'in-review',
      deps: {
        getIssue: async () => ({ ok: true as const, value: issue('s-progress') }),
        listStates: async () => ({ ok: true as const, value: STATES }),
        updateIssueState: async () => ({ ok: true as const, value: null }),
        ...overrides
      }
    } as Parameters<typeof runPlaneWorktreeStatusSync>[0]
  }

  it('reads the issue and states, then writes the mapped state', async () => {
    const updateIssueState = vi.fn(async () => ({ ok: true as const, value: null }))
    const result = await runPlaneWorktreeStatusSync(io({ updateIssueState }))

    expect(result).toEqual({ outcome: 'updated' })
    expect(updateIssueState).toHaveBeenCalledWith(settings, {
      projectId: 'project-1',
      issueId: 'issue-1',
      stateId: 's-review'
    })
  })

  // Why: a failed read must not be reported as a successful sync — the board would show a state
  // Plane never received.
  it('reports a failed issue read', async () => {
    const result = await runPlaneWorktreeStatusSync(
      io({ getIssue: async () => ({ ok: false as const, error: 'unauthorized' }) })
    )
    expect(result).toEqual({ outcome: 'failed', detail: 'unauthorized' })
  })

  it('reports a failed states read', async () => {
    const result = await runPlaneWorktreeStatusSync(
      io({ listStates: async () => ({ ok: false as const, error: 'project gone' }) })
    )
    expect(result).toEqual({ outcome: 'failed', detail: 'project gone' })
  })

  // Why: the pure mapper returns 'updated' as soon as the write callback resolves, so a rejected
  // PATCH has to be surfaced by the caller or it silently reads as success.
  it('reports a rejected write rather than success', async () => {
    const result = await runPlaneWorktreeStatusSync(
      io({ updateIssueState: async () => ({ ok: false as const, error: 'state not allowed' }) })
    )
    expect(result).toEqual({ outcome: 'failed', detail: 'state not allowed' })
  })

  it('skips a worktree with no Plane link without touching the provider', async () => {
    const getIssue = vi.fn()
    const result = await runPlaneWorktreeStatusSync({
      ...io({ getIssue }),
      worktree: { id: 'wt2' } as Worktree
    })
    expect(result).toEqual({ outcome: 'skipped' })
    expect(getIssue).not.toHaveBeenCalled()
  })
})
