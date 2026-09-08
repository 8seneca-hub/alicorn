import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestrationDb } from './db'
import { Coordinator } from './coordinator'
import { CoordinatorForemanJournal } from './coordinator-foreman-journal'
import type { CoordinatorRuntime } from './coordinator-runtime-contract'
import {
  journalPath,
  readJournal,
  wavePath,
  writeJournal,
  type Journal
} from '../../alicorn/foreman/journal'
import type { ForemanReport } from '../../../shared/alicorn/foreman-report'
import { readForemanRunView } from '../../alicorn/foreman/run-view-source'

let worktree = ''
let db: OrchestrationDb

function runtimeStub(handles: string[] = ['term_a']): CoordinatorRuntime {
  const terminals = handles.map((handle) => ({
    handle,
    worktreeId: 'wt1',
    connected: true,
    writable: true
  }))
  return {
    async sendTerminalAgentPrompt(handle) {
      return { handle, accepted: true, bytesWritten: 0 }
    },
    async listTerminals() {
      return { terminals }
    },
    async createTerminal(_selector, opts) {
      return { handle: 'term_a', worktreeId: 'wt1', title: opts?.title ?? '' }
    },
    async waitForTerminal(handle) {
      return { handle, condition: 'exit' }
    },
    async probeWorktreeDrift() {
      return null
    }
  }
}

function coordinatorFor(options: { orchestrated: boolean; taskSpecs?: string[] }): {
  coordinator: Coordinator
  taskIds: string[]
} {
  const taskIds = (options.taskSpecs ?? ['implement the feature']).map((spec) => {
    const task = db.createTask({ spec })
    if (options.orchestrated) {
      db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
    }
    return task.id
  })
  return {
    coordinator: new Coordinator(db, runtimeStub(), {
      spec: 'Ship partial refunds.',
      coordinatorHandle: 'coord',
      pollIntervalMs: 5,
      worktree: 'wt1',
      worktreePath: worktree
    }),
    taskIds
  }
}

function reportBody(overrides: Partial<ForemanReport> = {}): string {
  return JSON.stringify({
    status: 'done',
    summary: 'Did the thing.',
    changes: [{ path: 'src/api/refunds.ts', kind: 'modified', why: 'the endpoint' }],
    interface_delta: [],
    verification: { command: 'pnpm test', result: 'passed', evidence: '12 passed' },
    open_questions: [],
    artifacts: [],
    cost: { tokens_in: 1000, tokens_out: 200 },
    ...overrides
  })
}

/** worker_done only reconciles against a dispatch that exists, so this runs after dispatch. */
function settle(taskId: string, outcome: 'succeeded' | 'failed', body?: string): void {
  const dispatch = db.getDispatchContext(taskId)
  if (!dispatch) {
    throw new Error(`No dispatch for task ${taskId}`)
  }
  db.insertMessage({
    from: dispatch.assignee_handle ?? 'term_a',
    to: 'coord',
    subject: 'Done',
    type: 'worker_done',
    ...(body ? { body } : {}),
    payload: JSON.stringify({ taskId, dispatchId: dispatch.id, outcome }),
    senderPaneKey: dispatch.assignee_pane_key ?? undefined
  })
}

/** A plan the lead wrote before the coordinator started, with each node's footprint declared. */
async function planWithFiles(runId: string, files: Record<string, string[]>): Promise<void> {
  const journal: Journal = {
    runId,
    objective: 'Ship partial refunds.',
    status: 'running',
    startedAt: '2026-09-08T00:00:00.000Z',
    budgetCents: null,
    spentCents: null,
    decisions: [],
    assumptions: [],
    plan: Object.entries(files).map(([id, paths]) => ({
      id,
      title: `node ${id}`,
      owner: 'builder',
      dependsOn: [],
      status: 'pending' as const,
      model: null,
      dispatchId: null,
      files: paths
    })),
    waves: [],
    contractRegistry: '',
    log: [],
    notDone: []
  }
  await writeJournal(journalPath(worktree, runId), journal)
}

function inIdOrder(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
}

/** One terminal means one dispatch per tick, so each task settles on its own pass. */
async function drive(
  run: Promise<{ runId: string }>,
  taskIds: string[],
  outcomes: ('succeeded' | 'failed')[],
  bodies: (string | undefined)[] = []
): Promise<{ runId: string }> {
  for (const [index, taskId] of taskIds.entries()) {
    await waitFor(() => db.getDispatchContext(taskId) !== undefined)
    settle(taskId, outcomes[index] ?? 'succeeded', bodies[index])
  }
  return run
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('waitFor timed out')
}

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'orca-foreman-journal-'))
  db = new OrchestrationDb(':memory:')
})

afterEach(() => {
  db?.close()
  rmSync(worktree, { recursive: true, force: true })
})

describe('coordinator journalling', () => {
  it('creates the journal at run start for an orchestrated run', async () => {
    const { coordinator, taskIds } = coordinatorFor({ orchestrated: true })

    const result = await drive(coordinator.run(), taskIds, ['succeeded'])

    const journal = await readJournal(journalPath(worktree, result.runId))
    expect(journal).toMatchObject({ runId: result.runId, objective: 'Ship partial refunds.' })
  })

  // CLAUDE.md: everything must keep working with Foreman absent. The default path gains no file,
  // no directory and no write.
  it('writes no .foreman/ for a single run', async () => {
    const { coordinator, taskIds } = coordinatorFor({ orchestrated: false })

    await drive(coordinator.run(), taskIds, ['succeeded'])

    expect(existsSync(join(worktree, '.foreman'))).toBe(false)
  })

  it('seeds the plan from the DAG, then logs each node dispatched and done', async () => {
    const { coordinator, taskIds } = coordinatorFor({
      orchestrated: true,
      taskSpecs: ['backend endpoint', 'frontend against the contract']
    })
    const result = await drive(coordinator.run(), taskIds, ['succeeded', 'failed'])

    const journal = await readJournal(journalPath(worktree, result.runId))
    expect(journal?.plan.map((node) => node.title).sort()).toEqual([
      'backend endpoint',
      'frontend against the contract'
    ])
    const byId = new Map(journal?.plan.map((node) => [node.id, node]))
    expect(byId.get(taskIds[0]!)?.status).toBe('done')
    expect(byId.get(taskIds[1]!)?.status).toBe('failed')
    // The dispatch id is what the run view joins against to price the node.
    expect(byId.get(taskIds[0]!)?.dispatchId).toBe(db.getDispatchContext(taskIds[0]!)?.id)
    const lines = journal?.log.map((entry) => entry.line) ?? []
    expect(lines.some((line) => line.startsWith(`dispatched node ${taskIds[0]!}`))).toBe(true)
    expect(lines).toContain(`node ${taskIds[0]!} done`)
    expect(lines).toContain(`node ${taskIds[1]!} failed`)
  })

  it('records the run outcome', async () => {
    const { coordinator, taskIds } = coordinatorFor({ orchestrated: true })

    const result = await drive(coordinator.run(), taskIds, ['succeeded'])

    expect((await readJournal(journalPath(worktree, result.runId)))?.status).toBe('done')
  })

  // Why this is the load-bearing test: the lead's decisions and contract registry live in the same
  // file the coordinator writes node status into. A coordinator that rendered its own view of the
  // run would erase the only record of the lead's reasoning on its next dispatch.
  it('preserves the lead decisions across a coordinator restart', async () => {
    const first = coordinatorFor({ orchestrated: true })
    const firstResult = await drive(first.coordinator.run(), first.taskIds, ['succeeded'])
    const path = journalPath(worktree, firstResult.runId)

    // The lead writes into the journal between runs, as it would mid-run.
    const beforeRestart = await readJournal(path)
    beforeRestart!.decisions = [
      {
        n: 1,
        decision: 'Multi-currency at launch',
        chosen: 'yes',
        why: 'asked the user, they confirmed',
        reversible: false
      }
    ]
    beforeRestart!.contractRegistry = 'POST /refunds/partial'
    beforeRestart!.plan[0]!.owner = 'builder'
    beforeRestart!.plan[0]!.model = 'opus'
    await writeJournal(path, beforeRestart!)

    // A second Coordinator over the same run and worktree, as a restart produces.
    const secondTask = db.createTask({ spec: 'review' })
    db.setTaskExecutionStrategy(secondTask.id, 'orchestrated', 'user')
    const resumed = new Coordinator(db, runtimeStub(), {
      spec: 'Ship partial refunds.',
      coordinatorHandle: 'coord',
      pollIntervalMs: 5,
      worktree: 'wt1',
      worktreePath: worktree
    })
    await drive(resumed.runFromExistingRun(firstResult.runId), [secondTask.id], ['succeeded'])

    const after = await readJournal(path)
    expect(after?.decisions).toHaveLength(1)
    expect(after?.decisions[0]?.decision).toBe('Multi-currency at launch')
    expect(after?.contractRegistry).toBe('POST /refunds/partial')
    // The lead owns Owner and Model; the coordinator must not have reset them.
    const firstNode = after?.plan.find((node) => node.id === first.taskIds[0]!)
    expect(firstNode).toMatchObject({ owner: 'builder', model: 'opus' })
    // And the new node was still added.
    expect(after?.plan.some((node) => node.id === secondTask.id)).toBe(true)
    expect(after?.log.some((entry) => entry.line.includes('coordinator resumed'))).toBe(true)
  })

  it('is inert without a worktree path, rather than guessing where the run lives', async () => {
    const task = db.createTask({ spec: 'implement the feature' })
    db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
    const journal = new CoordinatorForemanJournal({ db, worktreePath: null })

    await journal.onRunStart('run_1', 'objective')

    expect(journal.isJournalling).toBe(false)
  })

  // A journal write must cost the record, not the work: the run still has to finish.
  it('does not fail the run when the journal cannot be written', async () => {
    const task = db.createTask({ spec: 'implement the feature' })
    db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
    const logs: string[] = []
    const journal = new CoordinatorForemanJournal({
      db,
      worktreePath: join(worktree, 'missing', '\0invalid'),
      onLog: (message) => logs.push(message)
    })

    await expect(journal.onRunStart('run_1', 'objective')).resolves.toBeUndefined()
    expect(logs.some((line) => line.includes('journal write failed'))).toBe(true)
  })

  // Why end to end: the coordinator writes markdown and the run view re-parses it from disk. A
  // renderer that cannot read what the writer emitted is two green unit suites and a blank panel.
  it('writes a journal the run view can read back', async () => {
    const { coordinator, taskIds } = coordinatorFor({
      orchestrated: true,
      taskSpecs: ['orient — map the area', 'backend endpoint']
    })

    const result = await drive(coordinator.run(), taskIds, ['succeeded', 'failed'])

    const view = await readForemanRunView(worktree)
    expect(view.state).toBe('ready')
    if (view.state !== 'ready') {
      return
    }
    expect(view.run).toMatchObject({ runId: result.runId, status: 'failed' })
    expect(view.run.plan.map((node) => node.title)).toContain('orient — map the area')
    const dispatched = view.run.plan.filter((node) => node.dispatchId !== null)
    expect(dispatched).toHaveLength(2)
  })

  it('records the waves the plan implies', async () => {
    const { coordinator, taskIds } = coordinatorFor({
      orchestrated: true,
      taskSpecs: ['backend endpoint', 'frontend against the contract']
    })

    const result = await drive(coordinator.run(), taskIds, ['succeeded', 'succeeded'])

    const journal = await readJournal(journalPath(worktree, result.runId))
    expect(journal?.waves).toHaveLength(1)
    expect(journal?.waves[0]?.nodeIds.sort()).toEqual([...taskIds].sort())
  })

  // The ticket in one test: two nodes with no edge between them, declaring the same file. They are
  // not independent whatever the DAG says, so only one of them is ever in flight — and two free
  // terminals mean that is a scheduling decision rather than an artefact of the stub.
  it('serialises two nodes that declare the same file, and journals the overlap', async () => {
    const taskIds = ['backend endpoint', 'frontend against the contract'].map((spec) => {
      const task = db.createTask({ spec })
      db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
      return task.id
    })
    const run = db.createCoordinatorRun({
      spec: 'Ship partial refunds.',
      coordinatorHandle: 'coord',
      pollIntervalMs: 5
    })
    await planWithFiles(run.id, { [taskIds[0]!]: ['src/a.ts'], [taskIds[1]!]: ['src/a.ts'] })

    const coordinator = new Coordinator(db, runtimeStub(['term_a', 'term_b']), {
      spec: 'Ship partial refunds.',
      coordinatorHandle: 'coord',
      pollIntervalMs: 5,
      worktree: 'wt1',
      worktreePath: worktree
    })
    const running = coordinator.runFromExistingRun(run.id)

    const [firstOut, secondOut] = inIdOrder(taskIds) as [string, string]
    await waitFor(() => db.getDispatchContext(firstOut) !== undefined)
    // Several poll intervals: without the hold the second node goes out in the same tick.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(db.getDispatchContext(secondOut)).toBeUndefined()

    settle(firstOut, 'succeeded')
    await waitFor(() => db.getDispatchContext(secondOut) !== undefined)
    settle(secondOut, 'succeeded')
    await running

    const journal = await readJournal(journalPath(worktree, run.id))
    const overlapped = journal!.waves.filter((wave) => wave.overlaps.length > 0)
    expect(overlapped).toHaveLength(2)
    expect(overlapped[0]!.nodeIds).toEqual([firstOut])
    expect(overlapped[1]!.nodeIds).toEqual([secondOut])
    expect(overlapped[0]!.overlaps[0]).toEqual({ path: 'src/a.ts', nodeIds: [firstOut, secondOut] })
    expect(journal!.log.some((entry) => entry.line.includes('serialised on src/a.ts'))).toBe(true)
  })

  // The lead reads one table, never N reports: that is what the reduce step buys.
  it('reduces a settled wave into one table and points the journal at it', async () => {
    const { coordinator, taskIds } = coordinatorFor({
      orchestrated: true,
      taskSpecs: ['backend endpoint', 'frontend against the contract']
    })

    const result = await drive(
      coordinator.run(),
      taskIds,
      ['succeeded', 'succeeded'],
      [
        reportBody({ summary: 'Wrote the endpoint.' }),
        reportBody({ summary: 'Wrote the form.', open_questions: ['which currency?'] })
      ]
    )

    const journal = await readJournal(journalPath(worktree, result.runId))
    const wave = journal!.waves[0]!
    expect(wave.reducedPath).toBe(`.foreman/${result.runId}/wave-1.md`)

    const table = readFileSync(wavePath(worktree, result.runId, 1), 'utf8')
    expect(table).toContain(`# Wave 1 — ${result.runId}`)
    expect(table).toContain('Wrote the endpoint.')
    expect(table).toContain('Wrote the form.')
    // Both reports named the same path, which is exactly what the lead has to be told.
    expect(table).toContain('⚠ src/api/refunds.ts')
    expect(table).toContain('**Wave tokens:** in 2000 / out 400')
    // Counts, not bodies: the open question stays in the report it came from.
    expect(table).not.toContain('which currency?')
    expect(
      journal!.log.some((entry) => entry.line.includes('wave 1 reduced from 2 report(s)'))
    ).toBe(true)
  })

  // A worker on a single-agent run sends free text. Nothing to reduce is not an error, and an empty
  // table would cost the lead a read that says nothing.
  it('writes no wave table when no bounded report came back', async () => {
    const { coordinator, taskIds } = coordinatorFor({ orchestrated: true })

    const result = await drive(coordinator.run(), taskIds, ['succeeded'], ['not json'])

    expect(existsSync(wavePath(worktree, result.runId, 1))).toBe(false)
    expect(
      (await readJournal(journalPath(worktree, result.runId)))!.waves[0]?.reducedPath
    ).toBeNull()
  })
})
