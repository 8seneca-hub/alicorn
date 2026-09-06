import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerAlicornHandlers } from './alicorn-handlers'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import {
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../alicorn/control-plane-http'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { Member, MemberInput } from '../../shared/alicorn/members'

const INPUT: MemberInput = {
  name: 'Reviewer',
  role: 'reviewer',
  backend: 'codex',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: []
}

const MEMBER: Member = {
  ...INPUT,
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
}

const setTaskExecutionStrategy = vi.fn()

function fakeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    listMembers: vi.fn().mockResolvedValue([MEMBER]),
    createMember: vi.fn().mockResolvedValue(MEMBER),
    updateMember: vi.fn().mockResolvedValue(MEMBER),
    deleteMember: vi.fn().mockResolvedValue(undefined),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProvenance: vi.fn(),
    getRunCost: vi.fn(),
    ...overrides
  } as unknown as ControlPlaneClient
}

function register(client: ControlPlaneClient | null): void {
  handlers.clear()
  registerAlicornHandlers({
    client,
    getOrchestrationDb: () => ({ setTaskExecutionStrategy }) as unknown as OrchestrationDb
  })
}

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

beforeEach(() => {
  setTaskExecutionStrategy.mockReset()
})

describe('members reads and writes', () => {
  it('returns the member list', async () => {
    register(fakeClient())
    await expect(invoke(ALICORN_IPC.membersList)).resolves.toEqual({
      ok: true,
      members: [MEMBER]
    })
  })

  it('creates, updates and deletes through the client', async () => {
    const client = fakeClient()
    register(client)

    await expect(invoke(ALICORN_IPC.membersCreate, INPUT)).resolves.toEqual({
      ok: true,
      member: MEMBER
    })
    await expect(invoke(ALICORN_IPC.membersUpdate, { id: 'm1', input: INPUT })).resolves.toEqual({
      ok: true,
      member: MEMBER
    })
    await expect(invoke(ALICORN_IPC.membersDelete, { id: 'm1' })).resolves.toEqual({ ok: true })

    expect(client.updateMember).toHaveBeenCalledWith('m1', INPUT)
    expect(client.deleteMember).toHaveBeenCalledWith('m1')
  })

  it('rejects a malformed payload before reaching the control plane', async () => {
    const client = fakeClient()
    register(client)

    await expect(invoke(ALICORN_IPC.membersCreate, 'not an object')).resolves.toEqual({
      ok: false,
      error: 'invalid_body'
    })
    await expect(invoke(ALICORN_IPC.membersUpdate, { input: INPUT })).resolves.toEqual({
      ok: false,
      error: 'invalid_body'
    })
    await expect(invoke(ALICORN_IPC.membersDelete, {})).resolves.toEqual({
      ok: false,
      error: 'invalid_body'
    })
    expect(client.createMember).not.toHaveBeenCalled()
  })
})

describe('control-plane failures become results, not rejections', () => {
  it('reports an unconfigured control plane', async () => {
    register(
      fakeClient({
        listMembers: vi.fn().mockRejectedValue(new ControlPlaneUnavailableError())
      })
    )

    await expect(invoke(ALICORN_IPC.membersList)).resolves.toEqual({
      ok: false,
      error: 'control_plane_unconfigured'
    })
  })

  it('reports a null client the same way, so the pane can explain itself', async () => {
    register(null)

    await expect(invoke(ALICORN_IPC.membersList)).resolves.toEqual({
      ok: false,
      error: 'control_plane_unconfigured'
    })
  })

  it('surfaces the request error code', async () => {
    register(
      fakeClient({
        listMembers: vi.fn().mockRejectedValue(new ControlPlaneRequestError(403, 'not_a_member'))
      })
    )

    await expect(invoke(ALICORN_IPC.membersList)).resolves.toEqual({
      ok: false,
      error: 'not_a_member'
    })
  })

  it('lets an unexpected error through rather than disguising it as a refusal', async () => {
    register(fakeClient({ listMembers: vi.fn().mockRejectedValue(new Error('boom')) }))

    await expect(invoke(ALICORN_IPC.membersList)).rejects.toThrow('boom')
  })
})

describe('execution strategy', () => {
  it('writes the strategy with its source', async () => {
    register(fakeClient())

    await expect(
      invoke(ALICORN_IPC.tasksSetExecutionStrategy, {
        taskId: 't1',
        strategy: 'orchestrated',
        source: 'escalation'
      })
    ).resolves.toEqual({ ok: true })

    // One call: setTaskExecutionStrategy stamps escalation_accepted_at itself
    // when the source is 'escalation'.
    expect(setTaskExecutionStrategy).toHaveBeenCalledTimes(1)
    expect(setTaskExecutionStrategy).toHaveBeenCalledWith('t1', 'orchestrated', 'escalation')
  })

  it('refuses an unknown strategy or source without touching the database', async () => {
    register(fakeClient())

    for (const args of [
      { taskId: 't1', strategy: 'team', source: 'user' },
      { taskId: 't1', strategy: 'single', source: 'robot' },
      { taskId: '', strategy: 'single', source: 'user' },
      {}
    ]) {
      await expect(invoke(ALICORN_IPC.tasksSetExecutionStrategy, args)).resolves.toEqual({
        ok: false
      })
    }
    expect(setTaskExecutionStrategy).not.toHaveBeenCalled()
  })
})
