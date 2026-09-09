import { describe, expect, it, vi } from 'vitest'
import { createTaskFeatureWorkspaceResolver } from './task-feature-workspaces'
import type { TaskWorktreeTuple } from '../../../shared/alicorn/feature-workspace-tuples'

const TUPLES: TaskWorktreeTuple[] = [
  { repoId: 'repo-api', worktreeId: 'wt-api', branch: 'feature', primary: true },
  { repoId: 'repo-web', worktreeId: 'wt-web', branch: null, primary: false }
]

const WORKTREES: Record<
  string,
  { id: string; path: string; repoId: string; hostId?: string | null }
> = {
  'wt-api': { id: 'wt-api', path: '/srv/api', repoId: 'repo-api', hostId: 'ssh:box' },
  'wt-web': { id: 'wt-web', path: '/work/web', repoId: 'repo-web', hostId: null },
  'wt-solo': { id: 'wt-solo', path: '/work/solo', repoId: 'repo-solo' }
}

function resolver(
  overrides: Partial<Parameters<typeof createTaskFeatureWorkspaceResolver>[0]> = {}
) {
  return createTaskFeatureWorkspaceResolver({
    listTaskWorktrees: () => TUPLES,
    showManagedWorktree: async (selector) => {
      const worktree = WORKTREES[selector.replace('id:', '')]
      if (!worktree) {
        throw new Error('selector_not_found')
      }
      return worktree
    },
    ...overrides
  })
}

describe('createTaskFeatureWorkspaceResolver', () => {
  it('resolves each tuple to a path and its own host — a set may span hosts', async () => {
    expect(await resolver()({ taskId: 'task-1', worktreeId: 'wt-api' })).toEqual([
      { repoId: 'repo-api', worktreeId: 'wt-api', path: '/srv/api', executionHostId: 'ssh:box' },
      { repoId: 'repo-web', worktreeId: 'wt-web', path: '/work/web', executionHostId: 'local' }
    ])
  })

  it('falls back to the dispatch worktree for a task that bound no tuples', async () => {
    const resolve = resolver({ listTaskWorktrees: () => [] })
    expect(await resolve({ taskId: 'task-1', worktreeId: 'wt-solo' })).toEqual([
      { repoId: 'repo-solo', worktreeId: 'wt-solo', path: '/work/solo', executionHostId: 'local' }
    ])
  })

  it('drops a workspace that is gone from disk rather than inventing a path', async () => {
    const resolve = resolver({
      listTaskWorktrees: () => [
        ...TUPLES,
        { repoId: 'repo-gone', worktreeId: 'wt-gone', branch: null, primary: false }
      ]
    })
    const workspaces = await resolve({ taskId: 'task-1', worktreeId: 'wt-api' })
    expect(workspaces.map((workspace) => workspace.repoId)).toEqual(['repo-api', 'repo-web'])
  })

  it('reads a malformed host as unresolved, never as local', async () => {
    const resolve = resolver({
      listTaskWorktrees: () => [TUPLES[0]!],
      showManagedWorktree: async () => ({
        id: 'wt-api',
        path: '/srv/api',
        repoId: 'repo-api',
        hostId: 'ssh:'
      })
    })
    expect(await resolve({ taskId: 'task-1', worktreeId: 'wt-api' })).toEqual([
      { repoId: 'repo-api', worktreeId: 'wt-api', path: '/srv/api', executionHostId: null }
    ])
  })

  it('asks the worktree registry once per tuple', async () => {
    const showManagedWorktree = vi.fn(async (selector: string) => WORKTREES[selector.slice(3)]!)
    await resolver({ showManagedWorktree })({ taskId: 'task-1', worktreeId: 'wt-api' })
    expect(showManagedWorktree).toHaveBeenCalledTimes(2)
  })
})
