import { describe, expect, it } from 'vitest'
import { folderWorkspaceToWorktree } from '../folder-workspace-worktree'
import type { FolderWorkspace } from '../folder-workspace-types'
import {
  duplicateGitRepoIds,
  groupTuplesByExecutionHost,
  normalizeTaskWorktreeTuples,
  partitionTuplesByReachability,
  primaryTaskWorktreeTuple,
  spansMultipleExecutionHosts,
  spansMultipleRepos,
  type ResolvedTaskWorktreeTuple
} from './feature-workspace-tuples'

function resolved(
  overrides: Partial<ResolvedTaskWorktreeTuple> & Pick<ResolvedTaskWorktreeTuple, 'worktreeId'>
): ResolvedTaskWorktreeTuple {
  return {
    repoId: 'repo_a',
    branch: 'main',
    primary: false,
    repoKind: 'git',
    executionHostId: 'local',
    path: '/tmp/a',
    ...overrides
  }
}

describe('normalizeTaskWorktreeTuples', () => {
  it('drops entries missing a repo or a worktree and trims the rest', () => {
    expect(
      normalizeTaskWorktreeTuples([
        { repoId: '  ', worktreeId: 'w1' },
        { repoId: 'repo_a', worktreeId: '   ' },
        { repoId: ' repo_b ', worktreeId: ' w2 ', branch: '  feature/x  ' }
      ])
    ).toEqual([{ repoId: 'repo_b', worktreeId: 'w2', branch: 'feature/x', primary: true }])
  })

  it('reads a blank or absent branch as null, which is what a folder workspace has', () => {
    const [folder, detached] = normalizeTaskWorktreeTuples([
      { repoId: 'folder-workspace:grp', worktreeId: 'folder:f1', branch: '' },
      { repoId: 'repo_a', worktreeId: 'w1' }
    ])
    expect(folder?.branch).toBeNull()
    expect(detached?.branch).toBeNull()
  })

  it('keys by worktree, so two folder workspaces sharing one project group both survive', () => {
    // Regression: folderWorkspaceToWorktree gives every folder workspace in a project group the
    // same `folder-workspace:<groupId>` repoId. Keying by repo collapsed the pair into one tuple.
    const group = (id: string): FolderWorkspace =>
      ({
        id,
        projectGroupId: 'grp_1',
        name: id,
        comment: '',
        folderPath: `/work/${id}`,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        createdAt: 0
      }) as unknown as FolderWorkspace

    const first = folderWorkspaceToWorktree(group('f1'))
    const second = folderWorkspaceToWorktree(group('f2'))
    expect(first.repoId).toBe(second.repoId)

    const tuples = normalizeTaskWorktreeTuples([
      { repoId: first.repoId, worktreeId: first.id },
      { repoId: second.repoId, worktreeId: second.id }
    ])
    expect(tuples.map((tuple) => tuple.worktreeId)).toEqual(['folder:f1', 'folder:f2'])
  })

  it('lets the last write for a worktree win while keeping its first position', () => {
    const tuples = normalizeTaskWorktreeTuples([
      { repoId: 'repo_a', worktreeId: 'w1', branch: 'old' },
      { repoId: 'repo_b', worktreeId: 'w2' },
      { repoId: 'repo_a', worktreeId: 'w1', branch: 'new' }
    ])
    expect(tuples.map((tuple) => tuple.worktreeId)).toEqual(['w1', 'w2'])
    expect(tuples[0]?.branch).toBe('new')
  })

  it('promotes the flagged tuple to index 0 and leaves exactly one primary', () => {
    const tuples = normalizeTaskWorktreeTuples([
      { repoId: 'repo_a', worktreeId: 'w1' },
      { repoId: 'repo_b', worktreeId: 'w2', primary: true },
      { repoId: 'repo_c', worktreeId: 'w3', primary: true }
    ])
    expect(tuples.map((tuple) => tuple.worktreeId)).toEqual(['w2', 'w1', 'w3'])
    expect(tuples.filter((tuple) => tuple.primary)).toHaveLength(1)
    expect(tuples[0]?.primary).toBe(true)
  })

  it('makes the first tuple primary when nothing is flagged', () => {
    const tuples = normalizeTaskWorktreeTuples([
      { repoId: 'repo_a', worktreeId: 'w1' },
      { repoId: 'repo_b', worktreeId: 'w2' }
    ])
    expect(tuples[0]).toMatchObject({ worktreeId: 'w1', primary: true })
    expect(tuples[1]?.primary).toBe(false)
  })

  it('returns an empty set rather than inventing a primary', () => {
    expect(normalizeTaskWorktreeTuples([])).toEqual([])
    expect(primaryTaskWorktreeTuple([])).toBeUndefined()
  })
})

describe('spansMultipleRepos', () => {
  it('is false for a single-repo task, which is the shape everything had before MR1', () => {
    expect(
      spansMultipleRepos(normalizeTaskWorktreeTuples([{ repoId: 'a', worktreeId: 'w1' }]))
    ).toBe(false)
  })

  it('is true once a second repo is bound — the signal MR2 offers escalation on', () => {
    expect(
      spansMultipleRepos(
        normalizeTaskWorktreeTuples([
          { repoId: 'a', worktreeId: 'w1' },
          { repoId: 'b', worktreeId: 'w2' }
        ])
      )
    ).toBe(true)
  })

  it('counts two folder workspaces in one project group as one repo', () => {
    expect(
      spansMultipleRepos(
        normalizeTaskWorktreeTuples([
          { repoId: 'folder-workspace:grp', worktreeId: 'folder:f1' },
          { repoId: 'folder-workspace:grp', worktreeId: 'folder:f2' }
        ])
      )
    ).toBe(false)
  })
})

describe('duplicateGitRepoIds', () => {
  it('flags two branches of one git repo', () => {
    expect(
      duplicateGitRepoIds([
        resolved({ worktreeId: 'w1', repoId: 'repo_a', branch: 'main' }),
        resolved({ worktreeId: 'w2', repoId: 'repo_a', branch: 'feature' }),
        resolved({ worktreeId: 'w3', repoId: 'repo_b' })
      ])
    ).toEqual(['repo_a'])
  })

  it('does not flag folder workspaces that share a project group id', () => {
    expect(
      duplicateGitRepoIds([
        resolved({ worktreeId: 'folder:f1', repoId: 'folder-workspace:grp', repoKind: 'folder' }),
        resolved({ worktreeId: 'folder:f2', repoId: 'folder-workspace:grp', repoKind: 'folder' })
      ])
    ).toEqual([])
  })
})

describe('execution host grouping', () => {
  const localFrontend = resolved({ worktreeId: 'w1', repoId: 'web', primary: true })
  const remoteBackend = resolved({
    worktreeId: 'w2',
    repoId: 'api',
    executionHostId: 'ssh:build-box',
    path: '/srv/api'
  })
  const remoteInfra = resolved({
    worktreeId: 'w3',
    repoId: 'infra',
    executionHostId: 'ssh:build-box',
    path: '/srv/infra'
  })

  it('groups a cross-host span per host, primary host first', () => {
    expect(groupTuplesByExecutionHost([localFrontend, remoteBackend, remoteInfra])).toEqual([
      { executionHostId: 'local', tuples: [localFrontend] },
      { executionHostId: 'ssh:build-box', tuples: [remoteBackend, remoteInfra] }
    ])
  })

  it('reports a cross-host span, and a same-host span as single', () => {
    expect(spansMultipleExecutionHosts([localFrontend, remoteBackend])).toBe(true)
    expect(spansMultipleExecutionHosts([remoteBackend, remoteInfra])).toBe(false)
  })

  it('gives a worker only the paths that exist on its own host', () => {
    const fromRemote = partitionTuplesByReachability(
      [localFrontend, remoteBackend, remoteInfra],
      'ssh:build-box'
    )
    expect(fromRemote.reachable.map((tuple) => tuple.path)).toEqual(['/srv/api', '/srv/infra'])
    expect(fromRemote.unreachable.map((tuple) => tuple.worktreeId)).toEqual(['w1'])
  })

  it('leaves nothing reachable when the asking host holds none of the tuples', () => {
    const { reachable, unreachable } = partitionTuplesByReachability(
      [localFrontend, remoteBackend],
      'ssh:other'
    )
    expect(reachable).toEqual([])
    expect(unreachable).toHaveLength(2)
  })
})
