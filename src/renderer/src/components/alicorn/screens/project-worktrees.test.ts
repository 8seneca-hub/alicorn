import { describe, expect, it } from 'vitest'
import type { Worktree, WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { groupWorktreesByStatus, projectWorktrees } from './project-worktrees'

const STATUSES = [
  { id: 'todo', label: 'Todo', color: 'neutral', icon: 'circle' },
  { id: 'in-progress', label: 'In progress', color: 'neutral', icon: 'circle' }
] as unknown as WorkspaceStatusDefinition[]

function worktree(id: string, status?: string): Worktree {
  return { id, workspaceStatus: status } as unknown as Worktree
}

describe('projectWorktrees', () => {
  it('collects the worktrees of every repository the project owns', () => {
    const byRepo = { 'repo-a': [worktree('w1')], 'repo-b': [worktree('w2')] }
    expect(projectWorktrees(byRepo, ['repo-a', 'repo-b']).map((w) => w.id)).toEqual(['w1', 'w2'])
  })

  it('is empty for a project that owns no repository', () => {
    expect(projectWorktrees({ 'repo-a': [worktree('w1')] }, [])).toEqual([])
  })

  it('ignores a bound repository the workspace has no worktrees for', () => {
    expect(projectWorktrees({}, ['repo-a'])).toEqual([])
  })
})

describe('groupWorktreesByStatus', () => {
  it('files each worktree under its status', () => {
    const columns = groupWorktreesByStatus(
      [worktree('w1', 'todo'), worktree('w2', 'in-progress')],
      STATUSES
    )
    expect(columns.map((column) => column.worktrees.map((w) => w.id))).toEqual([['w1'], ['w2']])
  })

  // A board that hides empty columns moves the others every time a card lands.
  it('keeps a column the workspace defines even when nothing is in it', () => {
    const columns = groupWorktreesByStatus([worktree('w1', 'todo')], STATUSES)
    expect(columns).toHaveLength(2)
    expect(columns[1]!.worktrees).toEqual([])
  })

  // Dropping it would lose work from a board that claims to show all of it.
  it('puts a worktree with no status in the first column rather than nowhere', () => {
    const columns = groupWorktreesByStatus([worktree('w1')], STATUSES)
    expect(columns[0]!.worktrees.map((w) => w.id)).toEqual(['w1'])
  })

  it('puts a worktree naming a retired status in the first column too', () => {
    const columns = groupWorktreesByStatus([worktree('w1', 'archived')], STATUSES)
    expect(columns[0]!.worktrees.map((w) => w.id)).toEqual(['w1'])
  })

  it('returns nothing when the workspace defines no statuses', () => {
    expect(groupWorktreesByStatus([worktree('w1')], [])).toEqual([])
  })
})
