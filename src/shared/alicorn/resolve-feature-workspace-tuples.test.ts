import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import { normalizeTaskWorktreeTuples } from './feature-workspace-tuples'
import {
  resolveTaskWorktreeTuples,
  type FeatureWorkspaceResolutionState,
  type GitWorktreeLocation
} from './resolve-feature-workspace-tuples'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  return {
    path: `/repos/${overrides.id}`,
    displayName: overrides.id,
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  } as Repo
}

function folderWorkspace(overrides: Partial<FolderWorkspace> & Pick<FolderWorkspace, 'id'>) {
  return {
    projectGroupId: 'grp_1',
    name: overrides.id,
    comment: '',
    folderPath: `/work/${overrides.id}`,
    linkedTask: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  } as FolderWorkspace
}

function state(
  overrides: Partial<FeatureWorkspaceResolutionState>
): FeatureWorkspaceResolutionState {
  return {
    repos: [],
    projectGroups: [] as readonly ProjectGroup[],
    folderWorkspaces: [],
    gitWorktreesById: new Map<string, GitWorktreeLocation>(),
    ...overrides
  }
}

describe('resolveTaskWorktreeTuples', () => {
  it('resolves a plain local single-repo task exactly as before MR1', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'web', worktreeId: 'web::/w/web', branch: 'main' }]),
      state({
        repos: [repo({ id: 'web' })],
        gitWorktreesById: new Map([['web::/w/web', { path: '/w/web' }]])
      })
    )
    expect(unresolved).toEqual([])
    expect(resolved).toEqual([
      {
        repoId: 'web',
        worktreeId: 'web::/w/web',
        branch: 'main',
        primary: true,
        repoKind: 'git',
        executionHostId: 'local',
        path: '/w/web'
      }
    ])
  })

  it('resolves a cross-host span: a local repo and one on an SSH box', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([
        { repoId: 'web', worktreeId: 'web::/w/web', branch: 'feat', primary: true },
        { repoId: 'api', worktreeId: 'api::/srv/api', branch: 'feat' }
      ]),
      state({
        repos: [repo({ id: 'web' }), repo({ id: 'api', executionHostId: 'ssh:build-box' })],
        gitWorktreesById: new Map([
          ['web::/w/web', { path: '/w/web' }],
          ['api::/srv/api', { path: '/srv/api' }]
        ])
      })
    )
    expect(unresolved).toEqual([])
    expect(resolved.map((tuple) => tuple.executionHostId)).toEqual(['local', 'ssh:build-box'])
    expect(resolved.map((tuple) => tuple.path)).toEqual(['/w/web', '/srv/api'])
  })

  it("lets the worktree's own host stamp outrank a repo row on another host", () => {
    const { resolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'api', worktreeId: 'api::/srv/api' }]),
      state({
        repos: [repo({ id: 'api', executionHostId: 'ssh:stale-box' })],
        gitWorktreesById: new Map([['api::/srv/api', { path: '/srv/api', hostId: 'ssh:real-box' }]])
      })
    )
    expect(resolved[0]?.executionHostId).toBe('ssh:real-box')
  })

  it('fails closed on an ambiguous repo rather than answering local', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'api', worktreeId: 'api::/srv/api' }]),
      state({
        // The same repo id registered on two hosts — no single answer, and `local` would be a
        // client-side read of a remote path.
        repos: [repo({ id: 'api' }), repo({ id: 'api', executionHostId: 'ssh:build-box' })],
        gitWorktreesById: new Map([['api::/srv/api', { path: '/srv/api' }]])
      })
    )
    expect(resolved).toEqual([])
    expect(unresolved).toEqual([
      { tuple: expect.objectContaining({ repoId: 'api' }), reason: 'host_ambiguous' }
    ])
  })

  it('reports an unknown repo as host_unknown, not as a missing workspace', () => {
    const { unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'gone', worktreeId: 'gone::/w/gone' }]),
      state({ gitWorktreesById: new Map([['gone::/w/gone', { path: '/w/gone' }]]) })
    )
    expect(unresolved[0]?.reason).toBe('host_unknown')
  })

  it('reports a worktree that is no longer on disk as workspace_missing', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'web', worktreeId: 'web::/w/deleted' }]),
      state({ repos: [repo({ id: 'web' })] })
    )
    expect(resolved).toEqual([])
    expect(unresolved[0]?.reason).toBe('workspace_missing')
  })

  it('resolves a folder workspace, which has no repo row and no branch', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'folder-workspace:grp_1', worktreeId: 'folder:f1' }]),
      state({ folderWorkspaces: [folderWorkspace({ id: 'f1' })] })
    )
    expect(unresolved).toEqual([])
    expect(resolved).toEqual([
      {
        repoId: 'folder-workspace:grp_1',
        worktreeId: 'folder:f1',
        branch: null,
        primary: true,
        repoKind: 'folder',
        executionHostId: 'local',
        path: '/work/f1'
      }
    ])
  })

  it('routes a folder workspace pinned to an SSH host to that host', () => {
    const { resolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'folder-workspace:grp_1', worktreeId: 'folder:f1' }]),
      state({
        folderWorkspaces: [folderWorkspace({ id: 'f1', executionHostId: 'ssh:build-box' })]
      })
    )
    expect(resolved[0]).toMatchObject({ executionHostId: 'ssh:build-box', repoKind: 'folder' })
  })

  it('mixes a git worktree and a folder workspace across two hosts in one feature workspace', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([
        { repoId: 'api', worktreeId: 'api::/srv/api', branch: 'feat', primary: true },
        { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:docs' }
      ]),
      state({
        repos: [repo({ id: 'api', executionHostId: 'ssh:build-box' })],
        folderWorkspaces: [folderWorkspace({ id: 'docs' })],
        gitWorktreesById: new Map([['api::/srv/api', { path: '/srv/api' }]])
      })
    )
    expect(unresolved).toEqual([])
    expect(resolved.map((tuple) => [tuple.repoKind, tuple.executionHostId])).toEqual([
      ['git', 'ssh:build-box'],
      ['folder', 'local']
    ])
  })

  it('reports a deleted folder workspace without dropping the rest of the set', () => {
    const { resolved, unresolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([
        { repoId: 'web', worktreeId: 'web::/w/web', primary: true },
        { repoId: 'folder-workspace:grp_1', worktreeId: 'folder:gone' }
      ]),
      state({
        repos: [repo({ id: 'web' })],
        gitWorktreesById: new Map([['web::/w/web', { path: '/w/web' }]])
      })
    )
    expect(resolved).toHaveLength(1)
    expect(unresolved).toEqual([
      { tuple: expect.objectContaining({ worktreeId: 'folder:gone' }), reason: 'workspace_missing' }
    ])
  })

  it('reads a folder-project repo as kind folder even though its id is worktree-shaped', () => {
    const { resolved } = resolveTaskWorktreeTuples(
      normalizeTaskWorktreeTuples([{ repoId: 'notes', worktreeId: 'notes::/w/notes' }]),
      state({
        repos: [repo({ id: 'notes', kind: 'folder' })],
        gitWorktreesById: new Map([['notes::/w/notes', { path: '/w/notes' }]])
      })
    )
    expect(resolved[0]?.repoKind).toBe('folder')
  })
})
