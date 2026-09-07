import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { memberBackendToTuiAgent, resolveWorkerMemberLaunch } from './worker-member-launch'
import type { MemberDirectory } from './member-directory'
import type { Member, MemberBackend, MemberRole } from '../../shared/alicorn/members'

function member(role: MemberRole, backend: MemberBackend): Member {
  return {
    id: 'm1',
    tenantId: 'local',
    createdBy: 'actor',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    name: 'Member',
    role,
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: []
  }
}

function directory(found: Member | null, enforce = true): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(found),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: enforce }),
    getRequiredChecks: vi.fn().mockResolvedValue([])
  }
}

describe('resolveWorkerMemberLaunch', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('passes the requested agent straight through with no member', async () => {
    await expect(
      resolveWorkerMemberLaunch({
        db,
        directory: directory(null),
        taskId: 't1',
        requestedAgent: 'claude'
      })
    ).resolves.toEqual({ agent: 'claude', dispatchMember: null, leadLaunch: null })
  })

  it('rejects an unknown member', async () => {
    const error = await resolveWorkerMemberLaunch({
      db,
      directory: directory(null),
      taskId: 't1',
      memberId: 'ghost'
    }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(OrchestrationError)
    expect((error as OrchestrationError).code).toBe('unknown_member')
  })

  it('forces the agent from the member backend', async () => {
    await expect(
      resolveWorkerMemberLaunch({
        db,
        directory: directory(member('developer', 'codex')),
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
      },
      leadLaunch: null
    })
  })

  it('rejects a requested agent that contradicts the member', async () => {
    const error = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('developer', 'codex')),
      taskId: 't1',
      memberId: 'm1',
      requestedAgent: 'claude'
    }).catch((thrown) => thrown)

    expect((error as OrchestrationError).code).toBe('member_agent_conflict')
  })

  it('accepts a requested agent that agrees with the member', async () => {
    await expect(
      resolveWorkerMemberLaunch({
        db,
        directory: directory(member('developer', 'codex')),
        taskId: 't1',
        memberId: 'm1',
        requestedAgent: 'codex'
      })
    ).resolves.toMatchObject({ agent: 'codex' })
  })

  it('does not consult the policy for a non-reviewer', async () => {
    const dir = directory(member('developer', 'codex'))

    await resolveWorkerMemberLaunch({ db, directory: dir, taskId: 't1', memberId: 'm1' })

    expect(dir.getOrgPolicy).not.toHaveBeenCalled()
  })
})

describe('the reviewer rule at launch', () => {
  let db: OrchestrationDb

  function seed(taskId: string, authorBackend: string): void {
    db.db
      .prepare('INSERT INTO tasks (id, run_id, spec, deps) VALUES (?, ?, ?, ?)')
      .run('dep', 'run_1', 'dep', '[]')
    db.db
      .prepare('INSERT INTO tasks (id, run_id, spec, deps) VALUES (?, ?, ?, ?)')
      .run(taskId, 'run_1', taskId, JSON.stringify(['dep']))
    db.db
      .prepare(
        "INSERT INTO dispatch_contexts (id, run_id, task_id, status) VALUES (?, ?, ?, 'completed')"
      )
      .run('d1', 'run_1', 'dep')
    db.db
      .prepare('INSERT INTO worker_dispatches (dispatch_id, start_options) VALUES (?, ?)')
      .run('d1', JSON.stringify({ agent: authorBackend }))
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('refuses a reviewer on the author backend', async () => {
    seed('t1', 'codex')

    const error = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('reviewer', 'codex')),
      taskId: 't1',
      memberId: 'm1'
    }).catch((thrown) => thrown)

    expect((error as OrchestrationError).code).toBe('reviewer_backend_conflict')
  })

  it('allows an explicit bypass and stamps it on the dispatch', async () => {
    seed('t1', 'codex')

    const launch = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('reviewer', 'codex')),
      taskId: 't1',
      memberId: 'm1',
      allowSameBackendReview: true
    })

    expect(launch.dispatchMember?.reviewBackendBypass).toBe(true)
  })

  it('allows a reviewer on a different backend with no bypass', async () => {
    seed('t1', 'claude')

    const launch = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('reviewer', 'codex')),
      taskId: 't1',
      memberId: 'm1'
    })

    expect(launch.dispatchMember?.reviewBackendBypass).toBe(false)
  })

  it('records a bypass even when the org policy is off', async () => {
    seed('t1', 'codex')

    const launch = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('reviewer', 'codex'), false),
      taskId: 't1',
      memberId: 'm1'
    })

    expect(launch.dispatchMember?.reviewBackendBypass).toBe(true)
  })
})

describe('memberBackendToTuiAgent', () => {
  it('maps every member backend to a launchable agent', () => {
    expect(memberBackendToTuiAgent('claude')).toBe('claude')
    expect(memberBackendToTuiAgent('codex')).toBe('codex')
    expect(memberBackendToTuiAgent('grok')).toBe('grok')
    expect(memberBackendToTuiAgent('openclaude')).toBe('openclaude')
  })
})

describe('lead dispatches', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('restricts a Claude-backed lead at launch', async () => {
    const result = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('other', 'claude')),
      taskId: 't1',
      memberId: 'm1',
      role: 'lead'
    })
    expect(result.leadLaunch?.disallowedTools).toContain('Write')
    expect(result.leadLaunch?.env.ALICORN_ROLE).toBe('lead')
  })

  // Why refuse: a lead that can quietly write code makes a run look orchestrated while being
  // nothing of the sort, and nothing downstream would notice.
  it('refuses a backend that cannot restrict its tools', async () => {
    await expect(
      resolveWorkerMemberLaunch({
        db,
        directory: directory(member('other', 'codex')),
        taskId: 't1',
        memberId: 'm1',
        role: 'lead'
      })
    ).rejects.toThrow(OrchestrationError)
  })

  it('names the refusing backend in the error code', async () => {
    let caught: unknown
    try {
      await resolveWorkerMemberLaunch({
        db,
        directory: directory(member('other', 'codex')),
        taskId: 't1',
        memberId: 'm1',
        role: 'lead'
      })
    } catch (error) {
      caught = error
    }
    expect((caught as OrchestrationError).code).toBe('lead_backend_unsupported')
  })

  // A lead is a member, always: an anonymous lead has no backend to restrict.
  it('requires a member for a lead dispatch', async () => {
    await expect(
      resolveWorkerMemberLaunch({ db, directory: directory(null), taskId: 't1', role: 'lead' })
    ).rejects.toThrow('pass --member')
  })

  it('leaves an ordinary worker dispatch unrestricted', async () => {
    const result = await resolveWorkerMemberLaunch({
      db,
      directory: directory(member('developer', 'codex')),
      taskId: 't1',
      memberId: 'm1'
    })
    expect(result.leadLaunch).toBeNull()
  })
})
