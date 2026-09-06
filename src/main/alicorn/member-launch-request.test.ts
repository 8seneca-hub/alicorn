import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { resolveMemberLaunchForRequest } from './member-launch-request'
import type { MemberDirectory } from './member-directory'
import type { Member } from '../../shared/alicorn/members'

const MEMBER: Member = {
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  name: 'Builder',
  role: 'developer',
  backend: 'codex',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: []
}

function host(directory: MemberDirectory | null) {
  return { getAlicornMemberDirectory: () => directory }
}

function directory(): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(MEMBER),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([])
  }
}

describe('resolveMemberLaunchForRequest', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('does not touch the directory for a launch with no member', async () => {
    const runtime = host(null)

    await expect(
      resolveMemberLaunchForRequest({ runtime, db, taskId: 't1', requestedAgent: 'claude' })
    ).resolves.toEqual({ agent: 'claude', dispatchMember: null })
  })

  it('rejects --member when the control plane is unconfigured', async () => {
    const error = await resolveMemberLaunchForRequest({
      runtime: host(null),
      db,
      taskId: 't1',
      memberId: 'm1'
    }).catch((thrown) => thrown)

    // Launching anyway would record no member, which is indistinguishable from
    // a direct launch in the ledger.
    expect(error).toBeInstanceOf(OrchestrationError)
    expect((error as OrchestrationError).code).toBe('control_plane_unconfigured')
    expect((error as OrchestrationError).message).toContain('ALICORN_CONTROL_API_URL')
  })

  it('resolves the member through the directory when configured', async () => {
    await expect(
      resolveMemberLaunchForRequest({
        runtime: host(directory()),
        db,
        taskId: 't1',
        memberId: 'm1'
      })
    ).resolves.toEqual({
      agent: 'codex',
      dispatchMember: {
        memberId: 'm1',
        memberRole: 'developer',
        backend: 'codex',
        reviewBackendBypass: false
      }
    })
  })
})
