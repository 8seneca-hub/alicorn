import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { resolveGateEvaluationInput } from './gate-evaluation-context'
import { UNMEASURED_RUN_BLAST_RADIUS, type RunBlastRadiusSource } from './run-blast-radius'

describe('resolveGateEvaluationInput', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function taskWithDispatch(worktreeId: string | null): { taskId: string; dispatchId: string } {
    const task = db.createTask({ spec: 'ship it' })
    const dispatch = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: 'term_worker',
      creator: { kind: 'system' },
      maxDepth: 3
    })
    // A settled worker row: the gate is opened after its dispatch finished, which is exactly
    // when the worktree still has to be resolvable.
    db.db
      .prepare(
        `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id) VALUES (?, 'succeeded', ?)`
      )
      .run(dispatch.id, worktreeId)
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('resolves the member, the project and the recorded checks', async () => {
    const { taskId, dispatchId } = taskWithDispatch('worktree-7')
    db.setDispatchMember({
      dispatchId,
      memberId: 'member-1',
      memberRole: 'developer',
      backend: 'claude',
      reviewBackendBypass: false
    })
    db.recordDispatchVerification({
      dispatchId,
      taskId,
      kind: 'diff_coverage',
      name: 'Diff coverage ≥ 80%',
      required: true,
      status: 'passed'
    })
    const showManagedWorktree = vi.fn().mockResolvedValue({ repoId: 'repo-1', projectId: 'proj-9' })

    const input = await resolveGateEvaluationInput(
      db,
      { showManagedWorktree, getAlicornBlastRadiusSource: () => null },
      { taskId, stageKey: 'review' }
    )

    expect(showManagedWorktree).toHaveBeenCalledWith('id:worktree-7')
    expect(input).toMatchObject({ projectId: 'proj-9', stageKey: 'review', memberId: 'member-1' })
    expect(input.verifications).toHaveLength(1)
    expect(input.verifications[0]).toMatchObject({ kind: 'diff_coverage', status: 'passed' })
  })

  it('falls back to the repo id when the worktree has no project', async () => {
    const { taskId } = taskWithDispatch('worktree-7')
    const input = await resolveGateEvaluationInput(
      db,
      {
        showManagedWorktree: vi.fn().mockResolvedValue({ repoId: 'repo-1' }),
        getAlicornBlastRadiusSource: () => null
      },
      { taskId, stageKey: 'build' }
    )
    expect(input.projectId).toBe('repo-1')
  })

  it('reports no project when the worktree cannot be resolved', async () => {
    const { taskId } = taskWithDispatch('worktree-gone')
    const input = await resolveGateEvaluationInput(
      db,
      {
        showManagedWorktree: vi.fn().mockRejectedValue(new Error('selector_not_found')),
        getAlicornBlastRadiusSource: () => null
      },
      { taskId, stageKey: 'build' }
    )
    expect(input).toMatchObject({ projectId: null, memberId: null })
  })

  it('reports no project and no member when the task never dispatched', async () => {
    const task = db.createTask({ spec: 'nothing ran' })
    const showManagedWorktree = vi.fn()
    const input = await resolveGateEvaluationInput(
      db,
      { showManagedWorktree, getAlicornBlastRadiusSource: () => null },
      { taskId: task.id, stageKey: 'build' }
    )
    expect(input).toEqual({
      projectId: null,
      stageKey: 'build',
      memberId: null,
      verifications: [],
      blastRadius: UNMEASURED_RUN_BLAST_RADIUS
    })
    expect(showManagedWorktree).not.toHaveBeenCalled()
  })

  it("measures the blast radius over the task's run, not the task", async () => {
    const { taskId } = taskWithDispatch('worktree-7')
    const runId = db.getTask(taskId)!.run_id
    const measure = vi.fn().mockResolvedValue({
      filesChanged: 42,
      spendCents: 900,
      changedPaths: ['infra/main.tf']
    })
    const source: RunBlastRadiusSource = { measure }

    const input = await resolveGateEvaluationInput(
      db,
      {
        showManagedWorktree: vi.fn().mockResolvedValue({ repoId: 'repo-1' }),
        getAlicornBlastRadiusSource: () => source
      },
      { taskId, stageKey: 'build' }
    )

    expect(measure).toHaveBeenCalledWith(runId)
    expect(input.blastRadius).toMatchObject({ filesChanged: 42, spendCents: 900 })
  })

  it('reads a throwing blast-radius source as unmeasured, never as clean', async () => {
    const { taskId } = taskWithDispatch('worktree-7')
    const input = await resolveGateEvaluationInput(
      db,
      {
        showManagedWorktree: vi.fn().mockResolvedValue({ repoId: 'repo-1' }),
        getAlicornBlastRadiusSource: () => ({
          measure: vi.fn().mockRejectedValue(new Error('git is gone'))
        })
      },
      { taskId, stageKey: 'build' }
    )
    expect(input.blastRadius).toEqual(UNMEASURED_RUN_BLAST_RADIUS)
  })
})
