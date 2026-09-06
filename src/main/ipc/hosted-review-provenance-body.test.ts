import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProvenance = vi.fn()
const getOrgPolicy = vi.fn()
const listMembers = vi.fn()
const getCurrentBranch = vi.fn()
const readPullRequestTemplate = vi.fn()

vi.mock('../alicorn/control-plane-client-instance', () => ({
  getControlPlaneClient: () => ({ getProvenance, getOrgPolicy, listMembers })
}))
vi.mock('../source-control/hosted-review-creation-git-state', () => ({
  getCurrentBranch: (...args: unknown[]) => getCurrentBranch(...args)
}))
vi.mock('../source-control/hosted-review-execution-host', () => ({
  hostedReviewSshConnectionId: () => null
}))
vi.mock('../github/client/create/pull-request-template', () => ({
  readPullRequestTemplate: () => readPullRequestTemplate()
}))

import { composeHostedReviewBodyWithProvenance } from './hosted-review-provenance-body'

const REPORT = {
  repoId: 'r1',
  branch: 'feature/x',
  outcomes: [
    {
      id: 'o1',
      tenantId: 'local',
      runId: 'run_1',
      taskId: 't1',
      dispatchId: 'd1',
      backend: 'claude' as const,
      stageKey: 'build',
      executionStrategy: 'single' as const,
      outcome: 'succeeded' as const,
      filesModified: [],
      reviewBackendBypass: false,
      escalationOffered: false,
      escalationAccepted: null,
      spendCents: 10,
      usage: null,
      gateDecision: 'auto',
      gateReason: '',
      createdAt: '2026-09-06T00:00:00.000Z'
    }
  ],
  verifications: [],
  contextCaptures: [],
  totals: { spendCents: 10, tasks: 1, dispatches: 1 },
  reviewBackend: { enforced: true, bypassed: false }
}

function call(overrides: Record<string, unknown> = {}) {
  return composeHostedReviewBodyWithProvenance({
    repoId: 'r1',
    worktreePath: '/w',
    executionHostId: 'local',
    body: 'hand written',
    useTemplate: undefined,
    ...overrides
  } as Parameters<typeof composeHostedReviewBodyWithProvenance>[0])
}

beforeEach(() => {
  getProvenance.mockReset().mockResolvedValue(REPORT)
  getOrgPolicy.mockReset().mockResolvedValue({ enforceDistinctReviewerBackend: true })
  listMembers.mockReset().mockResolvedValue([])
  getCurrentBranch.mockReset().mockResolvedValue('feature/x')
  readPullRequestTemplate.mockReset().mockResolvedValue('## Summary')
})

describe('composeHostedReviewBodyWithProvenance', () => {
  it('appends the provenance section', async () => {
    const composed = await call()

    expect(composed.body).toContain('hand written')
    expect(composed.body).toContain('<!-- alicorn:provenance:start -->')
    expect(composed.useTemplate).toBe(false)
  })

  it('uses the supplied head instead of reading git', async () => {
    await call({ head: 'explicit-branch' })

    expect(getCurrentBranch).not.toHaveBeenCalled()
    expect(getProvenance).toHaveBeenCalledWith('r1', 'explicit-branch')
  })

  it('names members through the directory', async () => {
    listMembers.mockResolvedValue([{ id: 'm1', name: 'Developer' }])
    getProvenance.mockResolvedValue({
      ...REPORT,
      outcomes: [{ ...REPORT.outcomes[0], memberId: 'm1' }]
    })

    expect((await call()).body).toContain('| build | Developer |')
  })
})

describe('a pull request never fails because the ledger is down', () => {
  it('returns the body untouched when provenance cannot be read', async () => {
    getProvenance.mockRejectedValue(new Error('offline'))

    await expect(call()).resolves.toEqual({ body: 'hand written', useTemplate: undefined })
  })

  it('returns the body untouched when the branch cannot be resolved', async () => {
    getCurrentBranch.mockRejectedValue(new Error('detached'))

    await expect(call()).resolves.toEqual({ body: 'hand written', useTemplate: undefined })
  })

  it('returns the body untouched when the run has no recorded steps', async () => {
    getProvenance.mockResolvedValue({ ...REPORT, outcomes: [] })

    await expect(call()).resolves.toEqual({ body: 'hand written', useTemplate: undefined })
  })

  it('still renders when the member list is unavailable', async () => {
    listMembers.mockRejectedValue(new Error('offline'))

    expect((await call()).body).toContain('<!-- alicorn:provenance:start -->')
  })

  it('assumes the reviewer rule was enforced when the policy is unreadable', async () => {
    // Claiming it was off would understate a bypass in a PR someone reviews.
    getOrgPolicy.mockRejectedValue(new Error('offline'))

    expect((await call()).body).toContain('enforced')
  })
})
