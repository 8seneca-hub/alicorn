import { describe, expect, it } from 'vitest'
import type { JournalNode } from './journal-types'
import {
  declaredFileOverlaps,
  holdsForFileOverlap,
  isWaveSettled,
  planWaves
} from './wave-dependency-check'

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

const nodeIdsOf = (waves: { nodeIds: string[] }[]): string[][] => waves.map((w) => w.nodeIds)

describe('planWaves', () => {
  it('has no waves for an empty plan', () => {
    expect(planWaves([])).toEqual([])
  })

  it('puts independent nodes that touch nothing in common in one wave', () => {
    const waves = planWaves([node('1'), node('2'), node('3')])
    expect(nodeIdsOf(waves)).toEqual([['1', '2', '3']])
  })

  it('layers by dependsOn', () => {
    const waves = planWaves([
      node('1'),
      node('2', { dependsOn: ['1'] }),
      node('3', { dependsOn: ['1'] }),
      node('4', { dependsOn: ['2', '3'] })
    ])
    expect(nodeIdsOf(waves)).toEqual([['1'], ['2', '3'], ['4']])
  })

  // The fake-edge test from GRAPH-ENGINEERING.md: most sequential pipelines are parallel work with
  // fake edges. A chain of nodes that needs nothing from the one before it collapses to one wave.
  it('collapses a chain of fake edges into one wave once the edges are gone', () => {
    const sequential = [
      node('1'),
      node('2', { dependsOn: ['1'] }),
      node('3', { dependsOn: ['2'] }),
      node('4', { dependsOn: ['3'] })
    ]
    expect(nodeIdsOf(planWaves(sequential))).toEqual([['1'], ['2'], ['3'], ['4']])

    // The same four nodes, asked whether each really needs the previous one's result. None did.
    const parallel = sequential.map((entry) => ({ ...entry, dependsOn: [] }))
    expect(nodeIdsOf(planWaves(parallel))).toEqual([['1', '2', '3', '4']])
  })

  // The other half of the same test: an edge that is *not* fake, because it is a shared file. These
  // four look parallel and are not, and the wave plan has to say so before anything is dispatched.
  it('serialises nodes with no edge between them but the same declared file', () => {
    const waves = planWaves([
      node('1', { files: ['src/a.ts'] }),
      node('2', { files: ['src/a.ts'] }),
      node('3', { files: ['src/b.ts'] }),
      node('4', { files: ['src/a.ts', 'src/c.ts'] })
    ])
    expect(nodeIdsOf(waves)).toEqual([['1', '3'], ['2'], ['4']])
  })

  it('journals the overlap on every wave the split scattered it across', () => {
    const waves = planWaves([
      node('1', { files: ['src/a.ts'] }),
      node('2', { files: ['src/a.ts'] })
    ])
    expect(waves).toHaveLength(2)
    expect(waves[0]!.overlaps).toEqual([{ path: 'src/a.ts', nodeIds: ['1', '2'] }])
    expect(waves[1]!.overlaps).toEqual([{ path: 'src/a.ts', nodeIds: ['1', '2'] }])
  })

  it('leaves overlaps empty when declared files are disjoint', () => {
    const waves = planWaves([
      node('1', { files: ['src/a.ts'] }),
      node('2', { files: ['src/b.ts'] })
    ])
    expect(nodeIdsOf(waves)).toEqual([['1', '2']])
    expect(waves[0]!.overlaps).toEqual([])
  })

  // Deterministic and earlier-id-first, so the same plan does not reshuffle between two reads of
  // the journal — a lead comparing waves across a restart has to see the same waves.
  it('keeps the earlier id in the earlier wave regardless of plan order', () => {
    const shuffled = planWaves([
      node('10', { files: ['src/a.ts'] }),
      node('2', { files: ['src/a.ts'] })
    ])
    expect(nodeIdsOf(shuffled)).toEqual([['2'], ['10']])
  })

  it('ignores dependencies on nodes outside the plan', () => {
    expect(nodeIdsOf(planWaves([node('1', { dependsOn: ['gone'] })]))).toEqual([['1']])
  })

  // A cycle must not spin the planner: a malformed plan still yields waves, and the cycle shows up
  // as a fat last wave rather than a hung coordinator.
  it('emits the survivors of a dependency cycle rather than looping', () => {
    const waves = planWaves([
      node('1', { dependsOn: ['2'] }),
      node('2', { dependsOn: ['1'] }),
      node('3')
    ])
    expect(nodeIdsOf(waves)).toEqual([['3'], ['1', '2']])
  })

  it('numbers waves from one, without gaps, across a file split', () => {
    const waves = planWaves([
      node('1', { files: ['src/a.ts'] }),
      node('2', { files: ['src/a.ts'] }),
      node('3', { dependsOn: ['1'] })
    ])
    expect(waves.map((wave) => wave.n)).toEqual([1, 2, 3])
  })
})

describe('declaredFileOverlaps', () => {
  it('reports only paths two or more nodes declared', () => {
    expect(
      declaredFileOverlaps([
        node('1', { files: ['src/a.ts', 'src/b.ts'] }),
        node('2', { files: ['src/b.ts'] })
      ])
    ).toEqual([{ path: 'src/b.ts', nodeIds: ['1', '2'] }])
  })

  // One node declaring a path twice is one claim, not an overlap with itself.
  it('does not treat a node repeating its own path as an overlap', () => {
    expect(declaredFileOverlaps([node('1', { files: ['src/a.ts', 'src/a.ts'] })])).toEqual([])
  })

  it('ignores blank declarations', () => {
    expect(declaredFileOverlaps([node('1', { files: [' '] }), node('2', { files: [''] })])).toEqual(
      []
    )
  })
})

describe('holdsForFileOverlap', () => {
  it('admits everything when no files are declared', () => {
    const plan = [node('1'), node('2')]
    expect(holdsForFileOverlap(plan, ['1', '2'])).toEqual([])
  })

  it('holds the later candidate when two ready nodes claim the same path', () => {
    const plan = [node('1', { files: ['src/a.ts'] }), node('2', { files: ['src/a.ts'] })]
    expect(holdsForFileOverlap(plan, ['1', '2'])).toEqual([
      { nodeId: '2', path: 'src/a.ts', blockedBy: '1' }
    ])
  })

  it('holds a candidate against a node that is already dispatched', () => {
    const plan = [
      node('1', { files: ['src/a.ts'], status: 'dispatched' }),
      node('2', { files: ['src/a.ts'] })
    ]
    expect(holdsForFileOverlap(plan, ['2'])).toEqual([
      { nodeId: '2', path: 'src/a.ts', blockedBy: '1' }
    ])
  })

  // A settled node has released its files; holding against one would stall the run forever.
  it.each(['done', 'failed'] as const)('does not hold against a %s node', (status) => {
    const plan = [node('1', { files: ['src/a.ts'], status }), node('2', { files: ['src/a.ts'] })]
    expect(holdsForFileOverlap(plan, ['2'])).toEqual([])
  })

  // The deadlock proof: nothing the coordinator has not offered can claim a file, so the earliest
  // candidate is only ever held by work that is running — and running work settles.
  it('does not hold against a pending node the coordinator did not offer', () => {
    const plan = [node('1', { files: ['src/a.ts'] }), node('2', { files: ['src/a.ts'] })]
    expect(holdsForFileOverlap(plan, ['2'])).toEqual([])
  })

  it('never holds the earliest candidate when nothing is dispatched', () => {
    const plan = ['1', '2', '3'].map((id) => node(id, { files: ['src/a.ts'] }))
    const held = holdsForFileOverlap(plan, ['3', '2', '1']).map((hold) => hold.nodeId)
    expect(held).toEqual(['2', '3'])
  })

  // A held node claims nothing, so a third node clashing only with it still goes out this wave.
  it('lets a node through that clashes only with a held one', () => {
    const plan = [
      node('1', { files: ['src/a.ts'], status: 'dispatched' }),
      node('2', { files: ['src/a.ts', 'src/b.ts'] }),
      node('3', { files: ['src/b.ts'] })
    ]
    expect(holdsForFileOverlap(plan, ['2', '3']).map((hold) => hold.nodeId)).toEqual(['2'])
  })

  it('ignores candidate ids that are not in the plan', () => {
    expect(holdsForFileOverlap([node('1')], ['1', 'ghost'])).toEqual([])
  })
})

describe('isWaveSettled', () => {
  it('is true only once every node reached a terminal status', () => {
    const plan = [node('1', { status: 'done' }), node('2', { status: 'failed' })]
    expect(isWaveSettled(plan, ['1', '2'])).toBe(true)
    expect(isWaveSettled([...plan, node('3')], ['1', '2', '3'])).toBe(false)
  })

  // An unknown id reads as unsettled: reducing a wave whose nodes we cannot see would be a lie.
  it('treats an unknown node as unsettled', () => {
    expect(isWaveSettled([node('1', { status: 'done' })], ['1', 'ghost'])).toBe(false)
  })
})
