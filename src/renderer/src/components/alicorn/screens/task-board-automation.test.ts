import { describe, expect, it } from 'vitest'
import type { TaskWorktreeTuple } from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { Worktree } from '../../../../../shared/worktree/types'
import { planTaskMoveAutomation } from './task-board-automation'

const tuple = (overrides: Partial<TaskWorktreeTuple> = {}): TaskWorktreeTuple => ({
  repoId: 'repo-a',
  worktreeId: 'wt-1',
  branch: 'feat/pay-1',
  primary: true,
  ...overrides
})

const worktrees = {
  'repo-a': [{ id: 'wt-1', repoId: 'repo-a', path: '/w/pay-1' }]
} as unknown as Record<string, Worktree[]>

describe('what a task move tells board automation', () => {
  it('names the task’s workspace and the column it landed in', () => {
    expect(
      planTaskMoveAutomation({
        tuples: [tuple()],
        worktreesByRepo: worktrees,
        fromColumn: 'todo',
        toColumn: 'in-review'
      })
    ).toEqual({
      worktreeId: 'wt-1',
      repoId: 'repo-a',
      worktreePath: '/w/pay-1',
      fromStatusId: 'todo',
      toStatusId: 'in-review'
    })
  })

  // Nowhere to run is not a failure; the card still moves.
  it('says nothing for a task that was never started', () => {
    expect(
      planTaskMoveAutomation({
        tuples: [],
        worktreesByRepo: worktrees,
        fromColumn: 'todo',
        toColumn: 'in-review'
      })
    ).toBeNull()
  })

  // A path belongs to its execution host; inventing one runs the dispatch in the wrong place.
  it('says nothing when this client cannot resolve the workspace', () => {
    expect(
      planTaskMoveAutomation({
        tuples: [tuple({ worktreeId: 'wt-elsewhere' })],
        worktreesByRepo: worktrees,
        fromColumn: 'todo',
        toColumn: 'in-review'
      })
    ).toBeNull()
  })

  it('says nothing when the column did not actually change', () => {
    expect(
      planTaskMoveAutomation({
        tuples: [tuple()],
        worktreesByRepo: worktrees,
        fromColumn: 'in-review',
        toColumn: 'in-review'
      })
    ).toBeNull()
  })

  it('uses the primary workspace when a task spans repositories', () => {
    const plan = planTaskMoveAutomation({
      tuples: [tuple({ repoId: 'repo-b', worktreeId: 'wt-2', primary: false }), tuple()],
      worktreesByRepo: worktrees,
      fromColumn: 'todo',
      toColumn: 'in-review'
    })

    expect(plan?.worktreeId).toBe('wt-1')
  })
})
