import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
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
    listRunContextCaptures: vi.fn(),
    getRunContextCapture: vi.fn(),
    ...overrides
  } as unknown as ControlPlaneClient
}

function register(client: ControlPlaneClient | null, db?: OrchestrationDb): void {
  handlers.clear()
  registerAlicornHandlers({
    client,
    getOrchestrationDb: () =>
      db ?? (({ setTaskExecutionStrategy }) as unknown as OrchestrationDb)
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

const REPORT = {
  repoId: 'repo',
  branch: 'feature/x',
  outcomes: [
    {
      id: 'o1',
      tenantId: 'local',
      runId: 'run_1',
      taskId: 't1',
      dispatchId: 'd1',
      memberId: 'm1',
      backend: 'claude',
      stageKey: 'merge',
      executionStrategy: 'single',
      outcome: 'succeeded',
      filesModified: ['a.ts'],
      reviewBackendBypass: false,
      escalationOffered: false,
      escalationAccepted: null,
      spendCents: 61,
      usage: null,
      gateDecision: 'gate',
      gateReason: 'irreversible',
      createdAt: '2026-09-07T00:00:00.000Z'
    }
  ],
  verifications: [],
  contextCaptures: [],
  totals: { spendCents: 61, tasks: 1, dispatches: 1 },
  reviewBackend: { enforced: true, bypassed: false }
}

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

describe('provenance', () => {
  it('returns the projection the panel renders, with the member named', async () => {
    const getProvenance = vi.fn().mockResolvedValue(REPORT)
    register(fakeClient({ getProvenance }))

    const result = (await invoke(ALICORN_IPC.provenanceGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })) as { ok: true; view: { steps: { member: string | null; gate: unknown }[] } }

    expect(getProvenance).toHaveBeenCalledWith('repo', 'feature/x')
    expect(result.ok).toBe(true)
    expect(result.view.steps[0]?.member).toBe('Reviewer')
    expect(result.view.steps[0]?.gate).toEqual({
      decision: 'gate',
      reason: 'irreversible',
      // PV2 and GP3 widened the gate view: the id the decision belongs to, and whether the
      // human agreed with the policy. This fixture's step never opened a gate.
      gateId: null,
      agreement: { recorded: false }
    })
  })

  it('fails closed on the reviewer rule when the policy cannot be read', async () => {
    // Saying the rule was off when we merely could not read it would understate a bypass.
    register(
      fakeClient({
        getProvenance: vi.fn().mockResolvedValue(REPORT),
        getOrgPolicy: vi.fn().mockRejectedValue(new Error('down'))
      })
    )

    const result = (await invoke(ALICORN_IPC.provenanceGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })) as { ok: true; view: { reviewerRule: string } }

    expect(result.view.reviewerRule).toBe('enforced')
  })

  it('reports the ledger being unreadable rather than an empty record', async () => {
    register(fakeClient({ getProvenance: vi.fn().mockRejectedValue(new Error('down')) }))

    await expect(
      invoke(ALICORN_IPC.provenanceGet, { repoId: 'repo', branch: 'feature/x' })
    ).resolves.toEqual({ ok: false, error: 'provenance_unavailable' })
  })

  it('refuses a request with no repo or branch without calling the ledger', async () => {
    const getProvenance = vi.fn()
    register(fakeClient({ getProvenance }))

    for (const args of [{ repoId: 'repo' }, { branch: 'feature/x' }, {}]) {
      await expect(invoke(ALICORN_IPC.provenanceGet, args)).resolves.toEqual({
        ok: false,
        error: 'invalid_body'
      })
    }
    expect(getProvenance).not.toHaveBeenCalled()
  })

  it('says the control plane is unconfigured rather than claiming no record exists', async () => {
    register(null)

    await expect(
      invoke(ALICORN_IPC.provenanceGet, { repoId: 'repo', branch: 'feature/x' })
    ).resolves.toEqual({ ok: false, error: 'control_plane_unconfigured' })
  })
})

describe('run inspector', () => {
  const CAPTURES = {
    captures: [
      {
        dispatchId: 'd1',
        createdAt: '2026-09-07T00:00:01.000Z',
        promptBytes: 0,
        prompt: null,
        promptPath: '/var/alicorn/prompts/d1.md',
        contextSlice: { taskSpec: 'x' }
      }
    ],
    truncated: false
  }
  const COST = {
    runId: 'run_1',
    totalSpendCents: 61,
    byDispatch: [{ dispatchId: 'd1', taskId: 't1', backend: 'claude', spendCents: 61 }]
  }

  it('resolves the branch, its newest run, its captures and its cost in one invoke', async () => {
    const listRunContextCaptures = vi.fn().mockResolvedValue(CAPTURES)
    const getRunCost = vi.fn().mockResolvedValue(COST)
    register(
      fakeClient({
        getProvenance: vi.fn().mockResolvedValue(REPORT),
        listRunContextCaptures,
        getRunCost
      })
    )

    const result = (await invoke(ALICORN_IPC.runInspectorGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })) as { ok: true; view: { runId: string; dispatches: { prompt: unknown }[] } }

    expect(listRunContextCaptures).toHaveBeenCalledWith('run_1')
    expect(getRunCost).toHaveBeenCalledWith('run_1')
    expect(result.view.runId).toBe('run_1')
    expect(result.view.dispatches[0]?.prompt).toEqual({
      kind: 'file',
      path: '/var/alicorn/prompts/d1.md'
    })
  })

  it('sends no prompt text across the wire, however large the capture was', async () => {
    register(
      fakeClient({
        getProvenance: vi.fn().mockResolvedValue(REPORT),
        listRunContextCaptures: vi.fn().mockResolvedValue({
          captures: [{ ...CAPTURES.captures[0], prompt: 'the exact prompt', promptPath: null }],
          truncated: false
        }),
        getRunCost: vi.fn().mockResolvedValue(COST)
      })
    )

    const result = await invoke(ALICORN_IPC.runInspectorGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })
    expect(JSON.stringify(result)).not.toContain('the exact prompt')
  })

  it('still shows the run when the captures or the cost cannot be read', async () => {
    register(
      fakeClient({
        getProvenance: vi.fn().mockResolvedValue(REPORT),
        listRunContextCaptures: vi.fn().mockRejectedValue(new Error('down')),
        getRunCost: vi.fn().mockRejectedValue(new Error('down'))
      })
    )

    const result = (await invoke(ALICORN_IPC.runInspectorGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })) as { ok: true; view: { dispatches: { prompt: unknown }[]; cost: unknown } }

    expect(result.view.dispatches[0]?.prompt).toEqual({ kind: 'none' })
    expect(result.view.cost).toEqual({ costUsd: null, partial: false })
  })

  it('reads no captures at all for a branch with no settled step', async () => {
    const listRunContextCaptures = vi.fn()
    register(
      fakeClient({
        getProvenance: vi.fn().mockResolvedValue({ ...REPORT, outcomes: [] }),
        listRunContextCaptures
      })
    )

    const result = (await invoke(ALICORN_IPC.runInspectorGet, {
      repoId: 'repo',
      branch: 'feature/x'
    })) as { ok: true; view: { runs: unknown[]; runId: string } }

    expect(result.view.runs).toEqual([])
    expect(result.view.runId).toBe('')
    expect(listRunContextCaptures).not.toHaveBeenCalled()
  })

  it('refuses a request with no repo or branch without calling the ledger', async () => {
    const getProvenance = vi.fn()
    register(fakeClient({ getProvenance }))

    for (const args of [{ repoId: 'repo' }, { branch: 'feature/x' }, {}]) {
      await expect(invoke(ALICORN_IPC.runInspectorGet, args)).resolves.toEqual({
        ok: false,
        error: 'invalid_body'
      })
    }
    expect(getProvenance).not.toHaveBeenCalled()
  })
})

describe('context capture', () => {
  it('reads one dispatch body by id rather than re-reading the run', async () => {
    const capture = {
      dispatchId: 'd1',
      createdAt: '2026-09-07T00:00:01.000Z',
      promptBytes: 5,
      prompt: 'hello',
      promptPath: null,
      contextSlice: {}
    }
    const getRunContextCapture = vi.fn().mockResolvedValue(capture)
    const listRunContextCaptures = vi.fn()
    register(fakeClient({ getRunContextCapture, listRunContextCaptures }))

    await expect(
      invoke(ALICORN_IPC.contextCaptureGet, { runId: 'run_1', dispatchId: 'd1' })
    ).resolves.toEqual({ ok: true, capture })
    expect(getRunContextCapture).toHaveBeenCalledWith('run_1', 'd1')
    expect(listRunContextCaptures).not.toHaveBeenCalled()
  })

  it('surfaces a missing capture as the ledger\'s own code, not as an empty prompt', async () => {
    register(
      fakeClient({
        getRunContextCapture: vi
          .fn()
          .mockRejectedValue(new ControlPlaneRequestError(404, 'not_found'))
      })
    )

    await expect(
      invoke(ALICORN_IPC.contextCaptureGet, { runId: 'run_1', dispatchId: 'nope' })
    ).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('refuses a request with no run or dispatch without calling the ledger', async () => {
    const getRunContextCapture = vi.fn()
    register(fakeClient({ getRunContextCapture }))

    for (const args of [{ runId: 'run_1' }, { dispatchId: 'd1' }, {}]) {
      await expect(invoke(ALICORN_IPC.contextCaptureGet, args)).resolves.toEqual({
        ok: false,
        error: 'invalid_body'
      })
    }
    expect(getRunContextCapture).not.toHaveBeenCalled()
  })
})

describe('gate panel reads and resolves (GP3)', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function pendingGate(level: number | null): { gateId: string; taskId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'ship it' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: JSON.stringify({ phase: 'build', body: 'done', filesModified: [] })
    })
    const gate = db.createGate({ taskId: task.id, question: 'Merge?', options: ['yes'] })
    if (level !== null) {
      db.setGateRecommendation(gate.id, { decision: 'auto', reason: 'auto', level })
    }
    register(fakeClient(), db)
    return { gateId: gate.id, taskId: task.id }
  }

  it('sends the recommendation at level 1 and withholds it at level 0', async () => {
    pendingGate(1)
    await expect(invoke(ALICORN_IPC.gatesList)).resolves.toMatchObject({
      ok: true,
      gates: [{ recommendation: { decision: 'auto', reason: 'auto' }, policyEvaluated: true }]
    })
    db.close()

    pendingGate(0)
    await expect(invoke(ALICORN_IPC.gatesList)).resolves.toMatchObject({
      ok: true,
      gates: [{ recommendation: null, policyEvaluated: true, autonomyLevel: 0 }]
    })
  })

  it('resolves the gate and enqueues the agreement, shown-flag derived from the level', async () => {
    const { gateId } = pendingGate(1)

    await expect(
      invoke(ALICORN_IPC.gatesResolve, {
        gateId,
        resolution: 'yes',
        humanGateDecision: 'gate'
      })
    ).resolves.toEqual({ ok: true, agreementRecorded: true })

    expect(db.getGate(gateId)?.status).toBe('resolved')
    const row = db.listDueLedgerOutbox(25).find((r) => r.kind === 'gate_agreement_patch')!
    expect(JSON.parse(row.payload)).toMatchObject({
      gateId,
      policyRecommendation: 'auto',
      humanGateDecision: 'gate',
      recommendationShown: true
    })
  })

  it('records the answer as given blind when the recommendation was withheld', async () => {
    const { gateId } = pendingGate(0)

    await invoke(ALICORN_IPC.gatesResolve, {
      gateId,
      resolution: 'yes',
      humanGateDecision: 'auto'
    })

    const row = db.listDueLedgerOutbox(25).find((r) => r.kind === 'gate_agreement_patch')!
    expect(JSON.parse(row.payload)).toMatchObject({ recommendationShown: false })
  })

  it('refuses a resolve that names no gate verdict', async () => {
    const { gateId } = pendingGate(1)

    await expect(
      invoke(ALICORN_IPC.gatesResolve, { gateId, resolution: 'yes' })
    ).resolves.toEqual({ ok: false, error: 'invalid_body' })
    expect(db.getGate(gateId)?.status).toBe('pending')
  })

  it('refuses to resolve a gate that is no longer pending', async () => {
    const { gateId } = pendingGate(1)
    db.resolveGate(gateId, 'already done')

    await expect(
      invoke(ALICORN_IPC.gatesResolve, { gateId, resolution: 'yes', humanGateDecision: 'auto' })
    ).resolves.toEqual({ ok: false, error: 'gate_not_pending' })
  })
})
