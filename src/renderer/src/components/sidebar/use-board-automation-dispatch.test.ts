// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Worktree, WorkspaceStatusDefinition } from '../../../../shared/worktree/types'
import { useBoardAutomationDispatch } from './use-board-automation-dispatch'

const statusChanged = vi.fn()

const STATUSES: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-review', label: 'In review' }
]

function worktree(over: Partial<Worktree> = {}): Worktree {
  return {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/tmp/wt-1',
    displayName: 'alc-49',
    workspaceStatus: 'todo',
    ...over
  } as Worktree
}

function dispatchFor(worktrees: Worktree[]) {
  const map = new Map(worktrees.map((item) => [item.id, item]))
  return renderHook(() =>
    useBoardAutomationDispatch({ worktreeById: map, workspaceStatuses: STATUSES })
  ).result.current
}

describe('useBoardAutomationDispatch', () => {
  beforeEach(() => {
    statusChanged.mockReset()
    statusChanged.mockResolvedValue({ dispatched: true })
    ;(window as unknown as { api: unknown }).api = { boardAutomation: { statusChanged } }
  })

  it('reports the move with both the old and the new column', () => {
    dispatchFor([worktree()])(['wt-1'], 'in-review')

    expect(statusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        repoId: 'repo-1',
        fromStatusId: 'todo',
        toStatusId: 'in-review',
        worktreePath: '/tmp/wt-1'
      })
    )
  })

  it('reports every workspace in a multi-card move', () => {
    dispatchFor([worktree(), worktree({ id: 'wt-2' })])(['wt-1', 'wt-2'], 'in-review')

    expect(statusChanged).toHaveBeenCalledTimes(2)
  })

  // Why: rules are bound to a board, and a workspace with no repo belongs to none.
  it('skips a workspace with no repo', () => {
    dispatchFor([worktree({ repoId: undefined as unknown as string })])(['wt-1'], 'in-review')

    expect(statusChanged).not.toHaveBeenCalled()
  })

  it('skips an unknown workspace', () => {
    dispatchFor([worktree()])(['missing'], 'in-review')

    expect(statusChanged).not.toHaveBeenCalled()
  })

  // Why: this rides a board move. A rule that cannot dispatch must never make the card fail to move.
  it('swallows a rejected notify', () => {
    statusChanged.mockRejectedValue(new Error('main is gone'))

    expect(() => dispatchFor([worktree()])(['wt-1'], 'in-review')).not.toThrow()
  })

  it('passes the linked Plane issue when the workspace has one', () => {
    dispatchFor([
      worktree({ linkedWorkItem: { planeIdentifier: 'ALC-49' } as Worktree['linkedWorkItem'] })
    ])(['wt-1'], 'in-review')

    expect(statusChanged).toHaveBeenCalledWith(expect.objectContaining({ issueRef: 'ALC-49' }))
  })
})
