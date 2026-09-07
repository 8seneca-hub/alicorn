import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { ForemanJournalRecorder } from './journal-writer'
import { journalPath, readJournal } from './journal'

let db: OrchestrationDb | undefined
let dir: string | undefined

afterEach(() => {
  db?.close()
  db = undefined
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

function setup(strategy: 'single' | 'orchestrated' | null) {
  dir = mkdtempSync(join(tmpdir(), 'foreman-writer-'))
  db = new OrchestrationDb(':memory:')
  const task = db.createTask({ spec: 'build the thing' })
  if (strategy) {
    db.setTaskExecutionStrategy(task.id, strategy, 'user')
  }
  const recorder = new ForemanJournalRecorder({
    db,
    runId: 'run_1',
    worktreePath: dir,
    objective: 'ship refunds',
    now: () => new Date('2026-09-07T00:00:00.000Z')
  })
  return { task, recorder, path: journalPath(dir, 'run_1') }
}

describe('ForemanJournalRecorder', () => {
  it('writes a journal for an orchestrated run', async () => {
    const { recorder, path, task } = setup('orchestrated')
    recorder.runStarted()
    await recorder.settled()

    const journal = await readJournal(path)
    expect(journal?.objective).toBe('ship refunds')
    expect(journal?.plan.map((node) => node.id)).toEqual([task.id])
    expect(journal?.log.at(-1)?.line).toBe('run started')
  })

  // `single` is the default and must stay indistinguishable from today's behaviour.
  it('writes nothing at all for a single-agent run', async () => {
    const { recorder, path } = setup('single')
    recorder.runStarted()
    recorder.nodeDispatched('task_1', 'term_worker')
    recorder.runFinished('done')
    await recorder.settled()

    expect(existsSync(path)).toBe(false)
  })

  it('writes nothing when no strategy was recorded', async () => {
    const { recorder, path } = setup(null)
    recorder.runStarted()
    await recorder.settled()
    expect(existsSync(path)).toBe(false)
  })

  it('logs a dispatch and carries the dispatch id onto the node', async () => {
    const { recorder, path, task } = setup('orchestrated')
    const dispatch = createRootDispatch(db!, task.id, 'term_worker')
    recorder.nodeDispatched(task.id, 'term_worker')
    await recorder.settled()

    const journal = await readJournal(path)
    expect(journal?.plan[0]?.dispatchId).toBe(dispatch.id)
    expect(journal?.log.at(-1)?.line).toContain('dispatched to term_worker')
  })

  it('records an escalation', async () => {
    const { recorder, path } = setup('orchestrated')
    recorder.escalated('term_worker', 'needs a decision')
    await recorder.settled()
    expect((await readJournal(path))?.log.at(-1)?.line).toContain('needs a decision')
  })

  it('closes the journal when the run finishes', async () => {
    const { recorder, path } = setup('orchestrated')
    recorder.runStarted()
    recorder.runFinished('failed')
    await recorder.settled()
    expect((await readJournal(path))?.status).toBe('failed')
  })

  // Why serialised: two events in one coordinator tick would otherwise interleave two
  // read-modify-writes of the same file and one would silently win.
  it('keeps every log line when events arrive together', async () => {
    const { recorder, path, task } = setup('orchestrated')
    recorder.runStarted()
    recorder.nodeDispatched(task.id, 'term_a')
    recorder.nodeSettled(task.id, 'completed')
    await recorder.settled()

    const journal = await readJournal(path)
    expect(journal?.log.map((entry) => entry.line)).toEqual([
      'run started',
      `node ${task.id} dispatched to term_a`,
      `node ${task.id} completed`
    ])
  })

  // Losing the record of a run is bad; killing the run to protect the record is worse.
  it('swallows a write failure rather than rejecting', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foreman-writer-'))
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'x' })
    db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
    const messages: string[] = []
    const recorder = new ForemanJournalRecorder({
      db,
      runId: 'run_1',
      // A path that cannot be created: the parent is a file, not a directory.
      worktreePath: join(dir, 'not-a-dir', 'deeper'),
      objective: 'x',
      onLog: (message) => messages.push(message)
    })
    recorder.runStarted()
    await expect(recorder.settled()).resolves.toBeUndefined()
  })

  // The plan table is rebuilt from the tasks, so it cannot drift from the run it describes.
  it('reflects a task added after the journal was created', async () => {
    const { recorder, path } = setup('orchestrated')
    recorder.runStarted()
    await recorder.settled()

    const second = db!.createTask({ spec: 'second' })
    recorder.nodeSettled(second.id, 'completed')
    await recorder.settled()

    expect((await readJournal(path))?.plan).toHaveLength(2)
  })
})
