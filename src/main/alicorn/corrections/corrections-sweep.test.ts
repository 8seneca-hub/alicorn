import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import {
  startCorrectionsSweep,
  type CorrectionsSweep,
  type CorrectionsSweepWorktree
} from './corrections-sweep'

describe('startCorrectionsSweep', () => {
  let db: OrchestrationDb
  let sweep: CorrectionsSweep | undefined
  const tempPaths: string[] = []

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    sweep?.stop()
    sweep = undefined
    db.close()
    for (const path of tempPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
    vi.useRealTimers()
  })

  function settleSucceeded(
    worktreeId: string,
    filesModified: string[]
  ): { taskId: string; dispatchId: string } {
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.recordWorkerStage({ dispatchId: dispatch.id, stage: 'input_accepted', worktreeId })
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: JSON.stringify({ filesModified })
    })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  function initGitRepo(): string {
    const repoPath = mkdtempSync(join(tmpdir(), 'alicorn-corrections-sweep-'))
    tempPaths.push(repoPath)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' })
    git('init', '--quiet')
    git('config', 'user.name', 'Alicorn Test')
    git('config', 'user.email', 'alicorn@example.test')
    git('config', 'commit.gpgSign', 'false')
    git('config', 'core.hooksPath', '.git/no-hooks')
    return repoPath
  }

  // Why not listDueLedgerOutbox() directly: settleWorkerReport already enqueues its own
  // step_outcome row for every fixture dispatch, so only human_verdict_patch is the sweep's own.
  function humanVerdictPatchRows(): ReturnType<OrchestrationDb['listDueLedgerOutbox']> {
    return db.listDueLedgerOutbox().filter((row) => row.kind === 'human_verdict_patch')
  }

  function commitFileAt(
    repoPath: string,
    fileName: string,
    isoDate: string,
    message: string
  ): void {
    writeFileSync(join(repoPath, fileName), 'x\n')
    execFileSync('git', ['add', fileName], { cwd: repoPath })
    execFileSync('git', ['commit', '--quiet', '-m', message], {
      cwd: repoPath,
      env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
    })
  }

  it('local worktree with a qualifying commit: one outbox row, scan stamped', async () => {
    const repoPath = initGitRepo()
    const { dispatchId } = settleSucceeded('wt_1', ['a.txt'])
    db.setDispatchLedgerOutcome(dispatchId, 'so_1', ['a.txt'])
    const now = Date.now()
    commitFileAt(repoPath, 'a.txt', new Date(now + 5_000).toISOString(), 'fix it')

    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: {
        showManagedWorktree: vi
          .fn()
          .mockResolvedValue({ id: 'wt_1', path: repoPath, repoId: 'repo_1' })
      },
      store: null,
      now: () => now + 10_000
    })

    const result = await sweep.tickOnce()

    expect(result).toEqual({ scanned: 1, corrections: 1, skipped: [] })
    const rows = humanVerdictPatchRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('human_verdict_patch')
    expect(rows[0].dedupe_key).toBe('human_verdict_patch:so_1')
    expect(JSON.parse(rows[0].payload)).toMatchObject({
      outcomeId: 'so_1',
      humanVerdict: 'amended',
      source: 'follow_up_commit'
    })
    expect(db.getCorrectionScan('wt_1')).not.toBeNull()
  })

  it('ssh route with an unreachable provider: skipped unverifiable, no row, no scan stamp', async () => {
    const { dispatchId } = settleSucceeded('wt_2', ['a.txt'])
    db.setDispatchLedgerOutcome(dispatchId, 'so_2', ['a.txt'])

    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: {
        showManagedWorktree: vi.fn().mockResolvedValue({
          id: 'wt_2',
          path: '/nonexistent/path',
          repoId: 'repo_2',
          hostId: 'ssh:corrections-sweep-test-unregistered'
        })
      },
      store: null
    })

    const result = await sweep.tickOnce()

    expect(result).toEqual({
      scanned: 0,
      corrections: 0,
      skipped: [{ worktreeId: 'wt_2', reason: 'unverifiable' }]
    })
    expect(humanVerdictPatchRows()).toHaveLength(0)
    expect(db.getCorrectionScan('wt_2')).toBeNull()
  })

  it('no .git at the worktree path: skipped not_a_git_worktree', async () => {
    const plainDir = mkdtempSync(join(tmpdir(), 'alicorn-corrections-sweep-nogit-'))
    tempPaths.push(plainDir)
    const { dispatchId } = settleSucceeded('wt_3', ['a.txt'])
    db.setDispatchLedgerOutcome(dispatchId, 'so_3', ['a.txt'])

    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: {
        showManagedWorktree: vi
          .fn()
          .mockResolvedValue({ id: 'wt_3', path: plainDir, repoId: 'repo_3' })
      },
      store: null
    })

    const result = await sweep.tickOnce()

    expect(result).toEqual({
      scanned: 0,
      corrections: 0,
      skipped: [{ worktreeId: 'wt_3', reason: 'not_a_git_worktree' }]
    })
    expect(db.getCorrectionScan('wt_3')).toBeNull()
  })

  it('an outcome id not yet posted by the drainer: step skipped this tick, nothing enqueued', async () => {
    settleSucceeded('wt_4', ['a.txt'])
    // no setDispatchLedgerOutcome: LC-R2 -- outcome id not yet known.

    const showManagedWorktree = vi.fn()
    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: { showManagedWorktree },
      store: null
    })

    const result = await sweep.tickOnce()

    expect(result).toEqual({ scanned: 0, corrections: 0, skipped: [] })
    expect(showManagedWorktree).not.toHaveBeenCalled()
    expect(humanVerdictPatchRows()).toHaveLength(0)
  })

  it('a worktree whose git reader throws does not stop the sweep for other worktrees', async () => {
    const goodRepo = initGitRepo()
    const brokenDir = mkdtempSync(join(tmpdir(), 'alicorn-corrections-sweep-broken-'))
    tempPaths.push(brokenDir)
    // Looks like a git worktree (passes the .git existence check) but isn't a real repo.
    mkdirSync(join(brokenDir, '.git'))

    const good = settleSucceeded('wt_good', ['a.txt'])
    db.setDispatchLedgerOutcome(good.dispatchId, 'so_good', ['a.txt'])
    const bad = settleSucceeded('wt_bad', ['b.txt'])
    db.setDispatchLedgerOutcome(bad.dispatchId, 'so_bad', ['b.txt'])

    const now = Date.now()
    commitFileAt(goodRepo, 'a.txt', new Date(now + 5_000).toISOString(), 'fix it')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: {
        showManagedWorktree: vi.fn().mockImplementation(async (selector: string) => {
          if (selector === 'id:wt_good') {
            return { id: 'wt_good', path: goodRepo, repoId: 'repo_good' }
          }
          return { id: 'wt_bad', path: brokenDir, repoId: 'repo_bad' }
        })
      },
      store: null,
      now: () => now + 10_000
    })

    const result = await sweep.tickOnce()

    expect(result.scanned).toBe(1)
    expect(result.corrections).toBe(1)
    expect(result.skipped).toEqual([
      { worktreeId: 'wt_bad', reason: 'scan_failed', message: expect.any(String) }
    ])
    expect(warnSpy).toHaveBeenCalled()
    const rows = humanVerdictPatchRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupe_key).toBe('human_verdict_patch:so_good')

    warnSpy.mockRestore()
  })

  it('does not run a second tick via the timer while the previous tick has not finished', async () => {
    vi.useFakeTimers()
    const { dispatchId } = settleSucceeded('wt_guard', ['a.txt'])
    db.setDispatchLedgerOutcome(dispatchId, 'so_guard', ['a.txt'])

    // Never resolves within the test: proves the guard, not a real completion.
    const showManagedWorktree = vi.fn(() => new Promise<CorrectionsSweepWorktree>(() => {}))

    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: { showManagedWorktree },
      store: null,
      intervalMs: 1000
    })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(showManagedWorktree).toHaveBeenCalledTimes(1)
  })

  it('reopened task detector: one row with source reopened_task and a non-negative amendedAfterMs', async () => {
    const task = db.createTask({ spec: 'work' })
    const { dispatch: dispatch1 } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch1.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch1.id,
      outcome: 'succeeded',
      result: JSON.stringify({ filesModified: [] })
    })
    db.setDispatchLedgerOutcome(dispatch1.id, 'so_reopen', [])

    db.updateTaskStatus(task.id, 'ready')
    db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })

    sweep = startCorrectionsSweep({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      store: null
    })

    const result = await sweep.tickOnce()

    expect(result.corrections).toBe(1)
    const rows = humanVerdictPatchRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupe_key).toBe('human_verdict_patch:so_reopen')
    const payload = JSON.parse(rows[0].payload)
    expect(payload).toMatchObject({
      outcomeId: 'so_reopen',
      humanVerdict: 'amended',
      source: 'reopened_task'
    })
    expect(typeof payload.amendedAfterMs).toBe('number')
    expect(payload.amendedAfterMs).toBeGreaterThanOrEqual(0)
  })
})
