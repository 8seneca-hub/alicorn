import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlPlaneClient } from './control-plane-client'
import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'
import type { Member, MemberInput } from '../../shared/alicorn/members'

const fetchMock = vi.fn()
const client = createControlPlaneClient({ fetch: fetchMock })

const INPUT: MemberInput = {
  name: 'Reviewer',
  role: 'reviewer',
  backend: 'codex',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: ['code-review']
}

const MEMBER: Member = {
  ...INPUT,
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function lastCall(): [string, string, RequestInit | undefined] {
  return fetchMock.mock.calls.at(-1) as [string, string, RequestInit | undefined]
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('members', () => {
  it('unwraps the list envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ members: [MEMBER] }))

    await expect(client.listMembers()).resolves.toEqual([MEMBER])
    expect(lastCall()[0]).toBe('control')
    expect(lastCall()[1]).toBe('/v1/members')
  })

  it('treats a missing list as empty rather than undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(client.listMembers()).resolves.toEqual([])
  })

  it('posts a create and maps the 201 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ member: MEMBER }))

    await expect(client.createMember(INPUT)).resolves.toEqual(MEMBER)

    const [service, path, init] = lastCall()
    expect(service).toBe('control')
    expect(path).toBe('/v1/members')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(INPUT)
  })

  it('updates with PUT, matching the route the control API serves', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ member: MEMBER }))

    await client.updateMember('m1', INPUT)

    const [, path, init] = lastCall()
    expect(path).toBe('/v1/members/m1')
    expect(init?.method).toBe('PUT')
  })

  it('deletes without parsing a body, because 204 has none', async () => {
    const response = { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    const jsonSpy = vi.spyOn(response, 'json')
    fetchMock.mockResolvedValue(response)

    await client.deleteMember('m1')

    expect(lastCall()[2]?.method).toBe('DELETE')
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('escapes an id so a crafted value cannot climb the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ member: MEMBER }))
    await client.updateMember('../policy/review-backend', INPUT)
    expect(lastCall()[1]).toBe('/v1/members/..%2Fpolicy%2Freview-backend')
  })
})

describe('policy and required checks', () => {
  it('reads the org policy unwrapped', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ enforceDistinctReviewerBackend: true }))

    await expect(client.getOrgPolicy()).resolves.toEqual({ enforceDistinctReviewerBackend: true })
    expect(lastCall()[1]).toBe('/v1/policy/review-backend')
  })

  it('unwraps the checks envelope', async () => {
    const check = {
      kind: 'diff_coverage',
      threshold: 0.8,
      lcovPath: 'coverage/lcov.info',
      timeoutMs: 600_000
    }
    fetchMock.mockResolvedValue(jsonResponse({ checks: [check] }))

    await expect(client.getRequiredChecks('proj-1')).resolves.toEqual([check])
    expect(lastCall()[1]).toBe('/v1/projects/proj-1/required-checks')
  })

  it('unwraps the authored-policies envelope for the audit view', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(client.listAutonomyPolicies('proj 1')).resolves.toEqual([])
    expect(lastCall()[1]).toBe('/v1/projects/proj%201/autonomy-policies')
  })

  it('PUTs a policy without an author — the control plane takes it from the caller', async () => {
    const input = {
      stageKey: 'merge',
      memberId: null,
      mode: 'never_gate' as const,
      minRuns: 10,
      minAcceptRate: 0.9,
      maxFiles: null,
      maxSpendCents: null,
      expiresAt: '2026-12-01T00:00:00.000Z'
    }
    fetchMock.mockResolvedValue(jsonResponse({ policy: { ...input, createdBy: 'actor' } }))

    await expect(client.putAutonomyPolicy('proj-1', input)).resolves.toMatchObject({
      createdBy: 'actor'
    })
    const [service, path, init] = lastCall()
    expect(service).toBe('control')
    expect(path).toBe('/v1/projects/proj-1/autonomy-policy')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('reads the track record from the ledger service, not the control service', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: 4 }))

    await client.getTrackRecord({ projectId: 'p1', stageKey: 'build', memberId: 'm1' })
    const [service, path] = lastCall()
    expect(service).toBe('ledger')
    expect(path).toBe('/v1/ledger/track-record?projectId=p1&stageKey=build&memberId=m1')
  })
})

describe('ledger reads', () => {
  it('reads provenance from the ledger service with both query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ repoId: 'r1', branch: 'feature/x' }))

    await client.getProvenance('r1', 'feature/x')

    const [service, path] = lastCall()
    expect(service).toBe('ledger')
    expect(path).toBe('/v1/ledger/provenance?repoId=r1&branch=feature%2Fx')
  })

  it('reads run cost from the ledger service', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ runId: 'run_1', totalSpendCents: 0, byDispatch: [] })
    )

    await client.getRunCost('run_1')

    expect(lastCall()[0]).toBe('ledger')
    expect(lastCall()[1]).toBe('/v1/ledger/runs/run_1/cost')
  })

  it('lists a run\'s context captures, keeping the ledger\'s truncation flag', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ captures: [], truncated: true }))

    await expect(client.listRunContextCaptures('run/1')).resolves.toEqual({
      captures: [],
      truncated: true
    })
    // Encoded, not interpolated: a run id with a slash must not invent a path segment.
    expect(lastCall()[1]).toBe('/v1/ledger/runs/run%2F1/context-captures')
  })

  it('reads one capture by dispatch rather than filtering the list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dispatchId: 'd 1', prompt: 'hi' }))

    await client.getRunContextCapture('run_1', 'd 1')

    expect(lastCall()[0]).toBe('ledger')
    expect(lastCall()[1]).toBe('/v1/ledger/runs/run_1/context-captures/d%201')
  })
})

describe('errors', () => {
  it('lets a request error through with its code intact', async () => {
    fetchMock.mockRejectedValue(new ControlPlaneRequestError(403, 'not_a_member'))

    const error = await client.listMembers().catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ControlPlaneRequestError)
    expect((error as ControlPlaneRequestError).code).toBe('not_a_member')
  })

  it('propagates an unconfigured control plane unchanged', async () => {
    fetchMock.mockRejectedValue(new ControlPlaneUnavailableError())

    await expect(client.createMember(INPUT)).rejects.toBeInstanceOf(ControlPlaneUnavailableError)
  })
})

describe('default wiring', () => {
  it('uses alicornFetch when no dependency is injected', async () => {
    // No env is configured in this process, so the real alicornFetch must be
    // what refuses — proving the client did not fall back to a bare fetch.
    await expect(createControlPlaneClient().listMembers()).rejects.toBeInstanceOf(
      ControlPlaneUnavailableError
    )
  })
})
