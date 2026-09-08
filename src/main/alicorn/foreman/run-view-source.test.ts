import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readForemanRunView } from './run-view-source'
import { renderJournal, type Journal } from './journal'

let worktree = ''

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    runId: 'run_1',
    objective: 'Ship partial refunds.',
    status: 'running',
    startedAt: '2026-09-07T00:00:00.000Z',
    budgetCents: 5_000,
    spentCents: 1_234,
    decisions: [],
    assumptions: [],
    plan: [
      {
        id: '1',
        title: 'orient',
        owner: 'scout',
        dependsOn: [],
        status: 'done',
        model: 'haiku',
        dispatchId: 'ctx_1',
        files: ['src/api/refunds.ts']
      }
    ],
    waves: [],
    contractRegistry: { entries: [], gaps: [], notes: '' },
    log: [],
    notDone: [],
    ...overrides
  }
}

function writeJournalAt(runId: string, markdown: string, mtimeSeconds?: number): void {
  const dir = join(worktree, '.foreman', runId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'journal.md')
  writeFileSync(path, markdown, 'utf8')
  if (mtimeSeconds !== undefined) {
    utimesSync(path, mtimeSeconds, mtimeSeconds)
  }
}

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'orca-run-view-'))
})

afterEach(() => {
  rmSync(worktree, { recursive: true, force: true })
})

describe('readForemanRunView', () => {
  // Why the ordinary case: most workspaces run nothing orchestrated, so an absent `.foreman/`
  // must not read as an error.
  it('reports no run when the workspace has no journal', async () => {
    await expect(readForemanRunView(worktree)).resolves.toEqual({ state: 'none' })
  })

  it('reads the run and its plan', async () => {
    writeJournalAt('run_1', renderJournal(journal()))

    const result = await readForemanRunView(worktree)

    expect(result).toMatchObject({
      state: 'ready',
      run: { runId: 'run_1', status: 'running', objective: 'Ship partial refunds.' }
    })
    expect(result.state === 'ready' && result.run.plan).toHaveLength(1)
  })

  // Why not the whole journal: decisions, assumptions, the log and the contract registry are not
  // drawn, and shipping them across IPC every poll spends bandwidth on text nobody reads.
  it('carries only what the view draws', async () => {
    writeJournalAt(
      'run_1',
      renderJournal(
        journal({ contractRegistry: { entries: [], gaps: [], notes: 'POST /refunds' } })
      )
    )

    const result = await readForemanRunView(worktree)

    expect(result.state === 'ready' && Object.keys(result.run).sort()).toEqual([
      'budgetCents',
      'objective',
      'plan',
      'runId',
      'startedAt',
      'status'
    ])
  })

  // A workspace can host several runs over its life; the current one is the one being written.
  it('picks the most recently written run', async () => {
    writeJournalAt('run_old', renderJournal(journal({ runId: 'run_old' })), 1_000)
    writeJournalAt('run_new', renderJournal(journal({ runId: 'run_new' })), 2_000)

    await expect(readForemanRunView(worktree)).resolves.toMatchObject({
      state: 'ready',
      run: { runId: 'run_new' }
    })
  })

  // Why not fall back to an older run: silently drawing a previous run would be a lie about the
  // state of the current one.
  it('reports a journal that does not parse, and says where', async () => {
    writeJournalAt('run_old', renderJournal(journal({ runId: 'run_old' })), 1_000)
    writeJournalAt('run_broken', '# not a journal\n', 2_000)

    const result = await readForemanRunView(worktree)

    expect(result.state).toBe('unreadable')
    expect(result.state === 'unreadable' && result.reason).toBeTruthy()
  })

  it('reports no run when a run directory holds no journal', async () => {
    mkdirSync(join(worktree, '.foreman', 'run_empty'), { recursive: true })

    await expect(readForemanRunView(worktree)).resolves.toEqual({ state: 'none' })
  })

  // The view is a poll; the declared footprint is a scheduling input, so it does not ride along.
  it("does not carry a node's declared files into the view", async () => {
    writeJournalAt('run_1', renderJournal(journal()))

    const result = await readForemanRunView(worktree)

    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      return
    }
    expect(result.run.plan[0]).not.toHaveProperty('files')
  })
})
