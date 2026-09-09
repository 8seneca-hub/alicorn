import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  JournalParseError,
  journalPath,
  parseJournal,
  readJournal,
  renderJournal,
  writeJournal,
  type Journal
} from './journal'

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    team: null,
    runId: 'run_alc42',
    objective: 'Ship partial refunds end to end.',
    status: 'running',
    startedAt: '2026-09-07T00:00:00.000Z',
    budgetCents: 5000,
    spentCents: 1234,
    decisions: [
      {
        n: 1,
        decision: 'Multi-currency at launch',
        chosen: 'yes',
        why: 'asked user, they confirmed',
        reversible: false
      }
    ],
    assumptions: [
      {
        n: 1,
        assumption: 'Idempotency keys scoped per merchant',
        blastRadius: 'contained',
        dependents: ['3', '4']
      }
    ],
    plan: [
      {
        id: '1',
        title: 'orient — map the area',
        owner: 'scout',
        dependsOn: [],
        status: 'done',
        model: 'haiku',
        dispatchId: 'ctx_1',
        files: []
      },
      {
        id: '2',
        title: 'backend endpoint',
        owner: 'builder',
        dependsOn: ['1'],
        status: 'dispatched',
        model: 'opus',
        dispatchId: null,
        files: ['src/api/refunds.ts']
      }
    ],
    waves: [
      { n: 1, nodeIds: ['1'], reducedPath: '.foreman/run_alc42/wave-1.md', overlaps: [] },
      {
        n: 2,
        nodeIds: ['2'],
        reducedPath: null,
        overlaps: [{ path: 'src/api/refunds.ts', nodeIds: ['1', '2'] }]
      }
    ],
    contractRegistry: {
      entries: [
        {
          repo: '',
          kind: 'endpoint',
          name: 'POST /refunds/partial',
          shape: 'body {amount: integer} → 201 Refund',
          provenance: 'extracted',
          source: 'openapi.yaml#/paths/~1refunds~1partial/post',
          breaking: false
        }
      ],
      gaps: [{ repo: 'ui', missing: 'no OpenAPI document', generate: 'an OpenAPI 3.1 document' }],
      notes: 'the lead typed this by hand'
    },
    log: [{ at: '00:01', line: 'node 2 dispatched' }],
    notDone: ['multi-region rollout'],
    ...overrides
  }
}

let tempDir: string | undefined

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('renderJournal / parseJournal', () => {
  // The whole point of the journal: a fresh lead picks up from the file alone, so whatever the
  // previous lead wrote has to survive the trip back.
  it('round-trips a full journal', () => {
    const original = journal()
    expect(parseJournal(renderJournal(original))).toEqual(original)
  })

  it('round-trips an empty journal', () => {
    const empty = journal({
      objective: '',
      budgetCents: null,
      spentCents: null,
      decisions: [],
      assumptions: [],
      plan: [],
      contractRegistry: { entries: [], gaps: [], notes: '' },
      log: [],
      notDone: [],
      waves: []
    })
    expect(parseJournal(renderJournal(empty))).toEqual(empty)
  })

  // A pipe in a title would otherwise split the row and shift every later column.
  it('round-trips content containing table pipes', () => {
    const piped = journal({
      plan: [
        {
          id: '1',
          title: 'parse a|b syntax',
          owner: 'builder',
          dependsOn: [],
          status: 'pending',
          model: null,
          dispatchId: null,
          files: ['src/a|b.ts']
        }
      ]
    })
    expect(parseJournal(renderJournal(piped))).toEqual(piped)
  })

  it('round-trips every node status', () => {
    const statuses = ['pending', 'dispatched', 'done', 'failed', 'blocked'] as const
    const all = journal({
      plan: statuses.map((status, index) => ({
        id: String(index),
        title: `node ${index}`,
        owner: 'builder',
        dependsOn: [],
        status,
        model: null,
        dispatchId: null,
        files: []
      }))
    })
    expect(parseJournal(renderJournal(all)).plan.map((n) => n.status)).toEqual([...statuses])
  })

  // The template writes planning/blocked; the plan's interface writes paused/failed. Both parse.
  it.each(['planning', 'running', 'paused', 'blocked', 'done', 'failed'] as const)(
    'round-trips run status %s',
    (status) => {
      expect(parseJournal(renderJournal(journal({ status }))).status).toBe(status)
    }
  )

  it('keeps money exact across the round trip', () => {
    const money = journal({ budgetCents: 1, spentCents: 99999 })
    const parsed = parseJournal(renderJournal(money))
    expect(parsed.budgetCents).toBe(1)
    expect(parsed.spentCents).toBe(99999)
  })

  it('names the section it gave up in', () => {
    const withoutPlan = renderJournal(journal()).replace('## Plan', '## Planning')
    expect(() => parseJournal(withoutPlan)).toThrow(JournalParseError)
    expect(() => parseJournal(withoutPlan)).toThrow('Plan: section is missing')
  })

  it('rejects an unknown node status rather than accepting it', () => {
    const bad = renderJournal(journal()).replace('| done |', '| finished |')
    expect(() => parseJournal(bad)).toThrow('Plan:')
  })

  it('rejects a journal with no heading', () => {
    expect(() => parseJournal('## Objective\nhi')).toThrow('title')
  })

  // A lead writes this file by hand; `# <id> — <title>` is what the template shows.
  // Files and Waves post-date the first journals, and a lead writes this file by hand. A journal
  // from before them has to keep loading — the waves are recomputed on the next write anyway.
  it('reads a journal written before Files and Waves existed', () => {
    const older = renderJournal(journal())
      .replace(/\n## Waves\n[\s\S]*?\n\n## Contract registry/, '\n\n## Contract registry')
      .replace(/ \| src\/api\/refunds\.ts \|$/m, ' |')
    const parsed = parseJournal(older)
    expect(parsed.waves).toEqual([])
    expect(parsed.plan[1]?.files).toEqual([])
  })

  it('round-trips a wave whose overlap names several nodes', () => {
    const many = journal({
      waves: [
        {
          n: 1,
          nodeIds: ['1', '2', '3'],
          reducedPath: null,
          overlaps: [
            { path: 'src/a.ts', nodeIds: ['1', '2'] },
            { path: 'src/b.ts', nodeIds: ['2', '3'] }
          ]
        }
      ]
    })
    expect(parseJournal(renderJournal(many)).waves).toEqual(many.waves)
  })

  it('accepts the template heading with a title after the run id', () => {
    const titled = renderJournal(journal()).replace('# run_alc42', '# run_alc42 — partial refunds')
    expect(parseJournal(titled).runId).toBe('run_alc42')
  })
})

describe('journalPath', () => {
  it('scopes the journal to the run inside the worktree', () => {
    expect(journalPath('/wt', 'run_1')).toBe(join('/wt', '.foreman', 'run_1', 'journal.md'))
  })
})

describe('readJournal / writeJournal', () => {
  it('creates the directory and round-trips through disk', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'foreman-journal-'))
    const path = journalPath(tempDir, 'run_1')
    await writeJournal(path, journal())
    await expect(readJournal(path)).resolves.toEqual(journal())
  })

  // A run that has not started a journal is not an error.
  it('reads an absent journal as null', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'foreman-journal-'))
    await expect(readJournal(journalPath(tempDir, 'nope'))).resolves.toBeNull()
  })

  // Why atomic: the journal is the only record of the run, so a crash mid-write must leave the
  // previous version readable rather than a half-file that no longer parses.
  it('leaves no temporary file behind', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'foreman-journal-'))
    const path = journalPath(tempDir, 'run_1')
    await writeJournal(path, journal())
    expect(() => readFileSync(`${path}.tmp`, 'utf8')).toThrow()
  })

  it('replaces a previous journal rather than appending to it', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'foreman-journal-'))
    const path = journalPath(tempDir, 'run_1')
    await writeJournal(path, journal())
    await writeJournal(path, journal({ status: 'done' }))
    const reread = await readJournal(path)
    expect(reread?.status).toBe('done')
    expect(readFileSync(path, 'utf8').match(/^# run_alc42/gm)?.length).toBe(1)
  })

  it('surfaces a corrupt journal as a parse error rather than null', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'foreman-journal-'))
    const path = journalPath(tempDir, 'run_1')
    mkdirSync(join(tempDir, '.foreman', 'run_1'), { recursive: true })
    writeFileSync(path, 'not a journal', 'utf8')
    await expect(readJournal(path)).rejects.toThrow(JournalParseError)
  })
})
