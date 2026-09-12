import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerAlicornRuleProposalHandlers } from './alicorn-rule-proposal-handlers'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import { ControlPlaneRequestError } from '../alicorn/control-plane-http'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import type { RuleProposal, RulebookCommitResult } from '../../shared/alicorn/rule-proposals'
import type { RulebookCommitRequest } from '../alicorn/rulebook/rulebook-commit'

const PROPOSAL: RuleProposal = {
  id: 'p1',
  tenantId: 'local',
  memberId: 'm1',
  outcomeId: 'o1',
  verdict: 'amended',
  context: { sha: 'abc1234', files: ['src/a.ts'] },
  proposedRule: null,
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-08T00:00:00.000Z'
}

const COMMITTED: RulebookCommitResult = {
  status: 'committed',
  filePath: '.alicorn/rules/builder-m1.md'
}

function fakeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    listRuleProposals: vi.fn().mockResolvedValue([PROPOSAL]),
    acceptRuleProposal: vi.fn().mockResolvedValue({ ...PROPOSAL, status: 'accepted' }),
    rejectRuleProposal: vi.fn().mockResolvedValue({ ...PROPOSAL, status: 'rejected' }),
    ...overrides
  } as unknown as ControlPlaneClient
}

function register(
  client: ControlPlaneClient | null,
  commitAcceptedRule?: (request: RulebookCommitRequest) => Promise<RulebookCommitResult>
): void {
  handlers.clear()
  registerAlicornRuleProposalHandlers({ client, commitAcceptedRule })
}

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

describe('listing proposals', () => {
  it('returns the member’s pending proposals', async () => {
    const client = fakeClient()
    register(client)

    const result = await invoke(ALICORN_IPC.ruleProposalsList, {
      memberId: 'm1',
      status: 'pending'
    })

    expect(result).toEqual({ ok: true, proposals: [PROPOSAL] })
    expect(client.listRuleProposals).toHaveBeenCalledWith('m1', 'pending')
  })

  it('drops a status the contract does not define rather than passing it through', async () => {
    const client = fakeClient()
    register(client)

    await invoke(ALICORN_IPC.ruleProposalsList, { memberId: 'm1', status: 'whatever' })

    expect(client.listRuleProposals).toHaveBeenCalledWith('m1', undefined)
  })

  it('refuses a call with no member', async () => {
    register(fakeClient())

    expect(await invoke(ALICORN_IPC.ruleProposalsList, {})).toEqual({
      ok: false,
      error: 'invalid_body'
    })
  })

  it('reports an unconfigured control plane rather than an empty list', async () => {
    register(null)

    expect(await invoke(ALICORN_IPC.ruleProposalsList, { memberId: 'm1' })).toEqual({
      ok: false,
      error: 'control_plane_unconfigured'
    })
  })
})

describe('accepting a proposal', () => {
  it('sends the human’s rule text and commits it to the repo', async () => {
    const client = fakeClient()
    const commit = vi.fn().mockResolvedValue(COMMITTED)
    register(client, commit)

    const result = await invoke(ALICORN_IPC.ruleProposalsAccept, {
      id: 'p1',
      rule: 'Always run the migration first.',
      memberName: 'Builder',
      worktreeId: 'w1',
      commitToRepo: true
    })

    expect(client.acceptRuleProposal).toHaveBeenCalledWith('p1', 'Always run the migration first.')
    expect(commit).toHaveBeenCalledWith({
      worktreeId: 'w1',
      memberId: 'm1',
      memberName: 'Builder',
      proposalId: 'p1',
      rule: 'Always run the migration first.'
    })
    expect(result).toMatchObject({ ok: true, commit: COMMITTED })
  })

  it('does not touch the repo when the human unchecked the commit', async () => {
    const commit = vi.fn()
    register(fakeClient(), commit)

    const result = await invoke(ALICORN_IPC.ruleProposalsAccept, {
      id: 'p1',
      rule: 'A rule.',
      memberName: 'Builder',
      worktreeId: 'w1',
      commitToRepo: false
    })

    expect(commit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ commit: { status: 'skipped', reason: 'not_requested' } })
  })

  // The server-side append is what makes acceptance real; the commit only makes it visible.
  it('still reports acceptance when the commit throws', async () => {
    const client = fakeClient()
    register(client, vi.fn().mockRejectedValue(new Error('git exploded')))

    const result = (await invoke(ALICORN_IPC.ruleProposalsAccept, {
      id: 'p1',
      rule: 'A rule.',
      memberName: 'Builder',
      worktreeId: 'w1',
      commitToRepo: true
    })) as { ok: boolean; commit: RulebookCommitResult }

    expect(result.ok).toBe(true)
    expect(result.commit).toEqual({
      status: 'skipped',
      reason: 'commit_failed',
      message: 'git exploded'
    })
  })

  it('refuses an empty rule, so acceptance always carries a constraint', async () => {
    const client = fakeClient()
    register(client)

    expect(await invoke(ALICORN_IPC.ruleProposalsAccept, { id: 'p1', rule: '   ' })).toEqual({
      ok: false,
      error: 'invalid_body'
    })
    expect(client.acceptRuleProposal).not.toHaveBeenCalled()
  })

  it('refuses a rule past the contract’s cap instead of letting the server 400', async () => {
    const client = fakeClient()
    register(client)

    expect(
      await invoke(ALICORN_IPC.ruleProposalsAccept, { id: 'p1', rule: 'x'.repeat(4001) })
    ).toEqual({ ok: false, error: 'invalid_body' })
    expect(client.acceptRuleProposal).not.toHaveBeenCalled()
  })

  it('surfaces a server refusal as a result the pane can render', async () => {
    register(
      fakeClient({
        acceptRuleProposal: vi
          .fn()
          .mockRejectedValue(new ControlPlaneRequestError(409, 'not_pending'))
      }),
      vi.fn().mockResolvedValue(COMMITTED)
    )

    expect(await invoke(ALICORN_IPC.ruleProposalsAccept, { id: 'p1', rule: 'A rule.' })).toEqual({
      ok: false,
      error: 'not_pending'
    })
  })
})

describe('rejecting a proposal', () => {
  it('rejects without touching the repo', async () => {
    const client = fakeClient()
    const commit = vi.fn()
    register(client, commit)

    const result = await invoke(ALICORN_IPC.ruleProposalsReject, { id: 'p1' })

    expect(client.rejectRuleProposal).toHaveBeenCalledWith('p1')
    expect(commit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, commit: { status: 'skipped' } })
  })
})
