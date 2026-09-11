import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultOnboardingState } from '../../../../shared/constants'
import { createTestStore, makeWorktree } from '../slices/store-test-helpers'

const worktreeActivation = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('../../lib/worktree-activation', () => ({
  activateAndRevealWorktree: worktreeActivation.activateAndRevealWorktree
}))

const reposAdd = vi.fn()
const pickFolder = vi.fn()
const worktreesList = vi.fn()
const onboardingGet = vi.fn()

beforeEach(() => {
  reposAdd.mockReset()
  pickFolder.mockReset()
  worktreesList.mockReset()
  onboardingGet.mockReset()
  worktreeActivation.activateAndRevealWorktree.mockReset()
  onboardingGet.mockResolvedValue({ ...getDefaultOnboardingState(), outcome: 'dismissed' })
  vi.stubGlobal('window', {
    api: {
      repos: { add: reposAdd, pickFolder },
      worktrees: { list: worktreesList },
      onboarding: { get: onboardingGet }
    }
  })
})

describe('binding a folder without opening it', () => {
  it('fetches the folder worktree but reveals nothing', async () => {
    reposAdd.mockResolvedValue({
      repo: { id: 'folder-1', path: '/bound', displayName: 'Bound', addedAt: 1 }
    })
    worktreesList.mockImplementation(({ repoId }: { repoId: string }) => [
      makeWorktree({ id: `${repoId}::/folder`, repoId })
    ])
    const store = createTestStore()

    const repo = await store.getState().addNonGitFolder('/bound', { openAfterAdd: false })

    expect(repo?.id).toBe('folder-1')
    // The project needs the worktree listed to show its work; it does not need it on screen.
    expect(store.getState().worktreesByRepo['folder-1']).toHaveLength(1)
    expect(worktreeActivation.activateAndRevealWorktree).not.toHaveBeenCalled()
    expect(store.getState().activeView).not.toBe('terminal')
  })

  it('still reveals when the caller did not ask to bind only', async () => {
    reposAdd.mockResolvedValue({
      repo: { id: 'folder-2', path: '/opened', displayName: 'Opened', addedAt: 2 }
    })
    worktreesList.mockImplementation(({ repoId }: { repoId: string }) => [
      makeWorktree({ id: `${repoId}::/folder`, repoId })
    ])
    const store = createTestStore()

    await store.getState().addNonGitFolder('/opened')

    expect(worktreeActivation.activateAndRevealWorktree).toHaveBeenCalled()
  })

  it('carries the intent into the non-git confirm, which is where the folder is actually added', async () => {
    pickFolder.mockResolvedValue('/plain-folder')
    reposAdd.mockRejectedValue(new Error('Not a valid git repository'))
    const store = createTestStore()

    const repo = await store.getState().addRepo({ openAfterAdd: false })

    expect(repo).toBeNull()
    expect(store.getState().activeModal).toBe('confirm-non-git-folder')
    expect(store.getState().modalData).toMatchObject({
      folderPath: '/plain-folder',
      openAfterAdd: false
    })
  })

  it('leaves the intent out of the confirm when the caller wants the folder opened', async () => {
    pickFolder.mockResolvedValue('/plain-folder')
    reposAdd.mockRejectedValue(new Error('Not a valid git repository'))
    const store = createTestStore()

    await store.getState().addRepo()

    expect(store.getState().modalData).not.toHaveProperty('openAfterAdd')
  })
})
