import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('task worktree tuple methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('reads back an empty set for a task that never bound one', () => {
    expect(db.listTaskWorktrees('task-1')).toEqual([])
    expect(db.countTaskRepos('task-1')).toBe(0)
  })

  it('round-trips a two-repo set in order with one primary', () => {
    db.setTaskWorktrees('task-1', [
      { repoId: 'repo_web', worktreeId: 'repo_web::/w/web', branch: 'feat/x' },
      { repoId: 'repo_api', worktreeId: 'repo_api::/w/api', branch: 'feat/x', primary: true }
    ])
    expect(db.listTaskWorktrees('task-1')).toEqual([
      { repoId: 'repo_api', worktreeId: 'repo_api::/w/api', branch: 'feat/x', primary: true },
      { repoId: 'repo_web', worktreeId: 'repo_web::/w/web', branch: 'feat/x', primary: false }
    ])
    expect(db.countTaskRepos('task-1')).toBe(2)
  })

  it('stores a folder workspace with a null branch, and keeps two that share a project group', () => {
    // folderWorkspaceToWorktree gives every folder workspace in a group the same repoId, so the
    // primary key has to be (task_id, worktree_id) or the second row silently replaces the first.
    db.setTaskWorktrees('task-1', [
      { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:f1' },
      { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:f2', branch: '' }
    ])
    const tuples = db.listTaskWorktrees('task-1')
    expect(tuples).toHaveLength(2)
    expect(tuples.map((tuple) => tuple.worktreeId)).toEqual(['folder:f1', 'folder:f2'])
    expect(tuples.every((tuple) => tuple.branch === null)).toBe(true)
    // Same project group, so this is one repo for MR2's escalation signal.
    expect(db.countTaskRepos('task-1')).toBe(1)
  })

  it('mixes a git worktree and a folder workspace in one feature workspace', () => {
    db.setTaskWorktrees('task-1', [
      { repoId: 'repo_api', worktreeId: 'repo_api::/w/api', branch: 'main', primary: true },
      { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:docs' }
    ])
    expect(db.listTaskWorktrees('task-1')).toEqual([
      { repoId: 'repo_api', worktreeId: 'repo_api::/w/api', branch: 'main', primary: true },
      { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:docs', branch: null, primary: false }
    ])
    expect(db.countTaskRepos('task-1')).toBe(2)
  })

  it('replaces the whole set rather than merging, so primary can never double up', () => {
    db.setTaskWorktrees('task-1', [
      { repoId: 'repo_web', worktreeId: 'w1', primary: true },
      { repoId: 'repo_api', worktreeId: 'w2' }
    ])
    db.setTaskWorktrees('task-1', [{ repoId: 'repo_api', worktreeId: 'w2', primary: true }])
    const tuples = db.listTaskWorktrees('task-1')
    expect(tuples).toEqual([
      { repoId: 'repo_api', worktreeId: 'w2', branch: null, primary: true }
    ])
  })

  it('unbinds a task when handed an empty set', () => {
    db.setTaskWorktrees('task-1', [{ repoId: 'repo_web', worktreeId: 'w1' }])
    db.setTaskWorktrees('task-1', [])
    expect(db.listTaskWorktrees('task-1')).toEqual([])
    expect(db.countTaskRepos('task-1')).toBe(0)
  })

  it('keeps one task’s set out of another’s', () => {
    db.setTaskWorktrees('task-1', [{ repoId: 'repo_web', worktreeId: 'w1' }])
    db.setTaskWorktrees('task-2', [{ repoId: 'repo_api', worktreeId: 'w2' }])
    expect(db.listTaskWorktrees('task-1').map((tuple) => tuple.worktreeId)).toEqual(['w1'])
    expect(db.listTaskWorktrees('task-2').map((tuple) => tuple.worktreeId)).toEqual(['w2'])
  })

  it('returns the set it stored, so a caller need not re-read to learn the primary', () => {
    const stored = db.setTaskWorktrees('task-1', [
      { repoId: 'repo_web', worktreeId: 'w1' },
      { repoId: 'repo_api', worktreeId: 'w2', primary: true }
    ])
    expect(stored).toEqual(db.listTaskWorktrees('task-1'))
  })
})
