import { describe, expect, it, vi } from 'vitest'
import { createBaseRefResolver } from './base-ref-resolver'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'

const REPO = { id: 'repo_1', path: '/repo', worktreeBaseRef: undefined } as Repo

function fakeStore(overrides?: {
  repos?: Repo[]
  meta?: { baseRef?: string; sparseBaseRef?: string }
}): Store {
  const repos = overrides?.repos ?? [REPO]
  const meta = overrides?.meta
  return {
    getRepos: () => repos,
    getWorktreeMeta: () => meta
  } as unknown as Store
}

describe('createBaseRefResolver', () => {
  it('prefers the worktree meta baseRef over everything else', async () => {
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore({ meta: { baseRef: 'develop' } }),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault: vi.fn()
    })

    const result = await resolveBaseRef('wt_1', '/repo/../wt_1')

    expect(result.baseRef).toBe('develop')
  })

  it('falls back to meta.sparseBaseRef when baseRef is absent', async () => {
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore({ meta: { sparseBaseRef: 'sparse-base' } }),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault: vi.fn()
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result.baseRef).toBe('sparse-base')
  })

  it('falls back to the repo’s configured worktreeBaseRef when meta has neither field', async () => {
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore({ repos: [{ ...REPO, worktreeBaseRef: 'release' } as Repo] }),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault: vi.fn()
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result.baseRef).toBe('release')
  })

  it('falls back to getBaseRefDefault(repo.path) when nothing is authored', async () => {
    const getBaseRefDefault = vi.fn().mockResolvedValue('origin/master')
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore(),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result.baseRef).toBe('origin/master')
    expect(getBaseRefDefault).toHaveBeenCalledWith('/repo', {})
  })

  it('falls back to origin/main when nothing resolves at all', async () => {
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore(),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault: vi.fn().mockResolvedValue(null)
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result.baseRef).toBe('origin/main')
  })

  it('returns the origin/main fallback with no lookups when the store is null', async () => {
    const showManagedWorktree = vi.fn()
    const resolveBaseRef = createBaseRefResolver({
      store: null,
      showManagedWorktree,
      getBaseRefDefault: vi.fn()
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result).toEqual({ baseRef: 'origin/main', gitOptions: {} })
    expect(showManagedWorktree).not.toHaveBeenCalled()
  })

  it('returns the origin/main fallback when the repo cannot be found', async () => {
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore({ repos: [] }),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault: vi.fn()
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(result.baseRef).toBe('origin/main')
  })

  it('passes the resolved wslDistro git options through to getBaseRefDefault and the result', async () => {
    const getBaseRefDefault = vi.fn().mockResolvedValue('origin/main')
    const getWorktreeGitOptions = vi.fn().mockReturnValue({ wslDistro: 'Ubuntu' })
    const resolveBaseRef = createBaseRefResolver({
      store: fakeStore(),
      showManagedWorktree: async () => ({ id: 'wt_1', repoId: 'repo_1' }),
      getBaseRefDefault,
      getWorktreeGitOptions
    })

    const result = await resolveBaseRef('wt_1', '/wt')

    expect(getBaseRefDefault).toHaveBeenCalledWith('/repo', { wslDistro: 'Ubuntu' })
    expect(result.gitOptions).toEqual({ wslDistro: 'Ubuntu' })
  })
})
