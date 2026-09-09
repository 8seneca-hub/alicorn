import { describe, expect, it } from 'vitest'
import type { Journal, JournalNode } from './journal-types'
import { recordWaves, upsertPlanNode } from './journal-writer'

function node(id: string, overrides: Partial<JournalNode> = {}): JournalNode {
  return {
    id,
    title: `node ${id}`,
    owner: 'builder',
    dependsOn: [],
    status: 'pending',
    model: null,
    dispatchId: null,
    files: [],
    ...overrides
  }
}

function journal(plan: JournalNode[], waves: Journal['waves'] = []): Journal {
  return {
    runId: 'run_1',
    objective: '',
    status: 'running',
    startedAt: '2026-09-08T00:00:00.000Z',
    budgetCents: null,
    spentCents: null,
    decisions: [],
    assumptions: [],
    plan,
    waves,
    contractRegistry: { entries: [], gaps: [], notes: '' },
    team: null,
    log: [],
    notDone: []
  }
}

describe('recordWaves', () => {
  it('derives the waves from the plan', () => {
    const current = journal([node('1'), node('2', { dependsOn: ['1'] })])
    recordWaves(current)
    expect(current.waves.map((wave) => wave.nodeIds)).toEqual([['1'], ['2']])
  })

  it('reports an overlap the first time it appears, and not again', () => {
    const current = journal([
      node('1', { files: ['src/a.ts'] }),
      node('2', { files: ['src/a.ts'] })
    ])
    expect(recordWaves(current)).toEqual([{ path: 'src/a.ts', nodeIds: ['1', '2'] }])
    expect(recordWaves(current)).toEqual([])
  })

  // The split scatters one overlap across two waves; the lead should be told about it once.
  it('reports an overlap once even though two waves carry it', () => {
    const current = journal([node('1', { files: ['a'] }), node('2', { files: ['a'] })])
    expect(recordWaves(current)).toHaveLength(1)
  })

  // `reducedPath` is the one thing on a wave that is a fact about the run rather than a derivation.
  it('keeps a wave table already written when the waves are recomputed', () => {
    const current = journal(
      [node('1', { status: 'done' })],
      [{ n: 1, nodeIds: ['1'], reducedPath: '.foreman/run_1/wave-1.md', overlaps: [] }]
    )
    recordWaves(current)
    expect(current.waves[0]?.reducedPath).toBe('.foreman/run_1/wave-1.md')
  })

  it('reports a new overlap that appears once the lead declares the second node', () => {
    const current = journal([node('1', { files: ['src/a.ts'] }), node('2')])
    expect(recordWaves(current)).toEqual([])
    current.plan[1]!.files = ['src/a.ts']
    expect(recordWaves(current)).toEqual([{ path: 'src/a.ts', nodeIds: ['1', '2'] }])
  })
})

describe('upsertPlanNode', () => {
  it('gives a node an empty footprint until the lead declares one', () => {
    const current = journal([])
    upsertPlanNode(current, { id: '1' })
    expect(current.plan[0]?.files).toEqual([])
  })

  // The lead owns Files; a coordinator status write must not clear what it declared.
  it('does not clear declared files when the coordinator writes status', () => {
    const current = journal([node('1', { files: ['src/a.ts'] })])
    upsertPlanNode(current, { id: '1', status: 'done' })
    expect(current.plan[0]).toMatchObject({ status: 'done', files: ['src/a.ts'] })
  })
})
