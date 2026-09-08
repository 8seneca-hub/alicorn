import { describe, expect, it } from 'vitest'
import { correctionTo, forwardTo, newStage } from './workflow-draft'
import { layoutWorkflowGraph, transitionId } from './workflow-graph-layout'

const SPINE = [newStage('spec', 0), newStage('build', 1), newStage('review', 2)]

describe('layoutWorkflowGraph', () => {
  it('stacks stages in ordinal order regardless of the order they arrive in', () => {
    const layout = layoutWorkflowGraph({ stages: [...SPINE].toReversed(), transitions: [] })
    expect(layout.stages.map((s) => s.stage.key)).toEqual(['spec', 'build', 'review'])
    expect(layout.stages.map((s) => s.y)).toEqual(
      layout.stages.map((s) => s.y).sort((a, b) => a - b)
    )
    expect(new Set(layout.stages.map((s) => s.x)).size).toBe(1)
  })

  it('runs an adjacent forward edge straight down the spine', () => {
    const layout = layoutWorkflowGraph({ stages: SPINE, transitions: [forwardTo('spec', 'build')] })
    expect(layout.edges[0]).toMatchObject({ route: 'spine', kind: 'forward' })
  })

  // The return path is the one thing that travels upward, so it gets its own margin.
  it('routes a correction edge through the right margin, back up to its target', () => {
    const layout = layoutWorkflowGraph({
      stages: SPINE,
      transitions: [correctionTo('review', 'build')]
    })
    const edge = layout.edges[0]!
    expect(edge).toMatchObject({ route: 'right', kind: 'correction' })
    expect(edge.tip.y).toBeLessThan(layout.stages[2]!.y)
    expect(edge.tip.x).toBeGreaterThanOrEqual(layout.stages[0]!.x + layout.stages[0]!.width)
  })

  it('routes a forward edge that skips a stage through the left margin', () => {
    const layout = layoutWorkflowGraph({
      stages: SPINE,
      transitions: [forwardTo('spec', 'review')]
    })
    expect(layout.edges[0]).toMatchObject({ route: 'left', kind: 'forward' })
    expect(layout.edges[0]!.tip.x).toBeLessThanOrEqual(layout.stages[0]!.x)
  })

  // Drawing an authored `correction` as a forward arc would hide the mistake the reorder made.
  it('draws an edge authored correction as a return even when it points forward', () => {
    const layout = layoutWorkflowGraph({
      stages: SPINE,
      transitions: [{ ...correctionTo('spec', 'review'), kind: 'correction' }]
    })
    expect(layout.edges[0]).toMatchObject({ route: 'right', kind: 'correction' })
  })

  it('gives two overlapping returns separate lanes and one non-overlapping pair the same lane', () => {
    const long = [...SPINE, newStage('verify', 3), newStage('merge', 4)]
    const overlapping = layoutWorkflowGraph({
      stages: long,
      transitions: [correctionTo('review', 'spec'), correctionTo('verify', 'build')]
    })
    const [a, b] = overlapping.edges.map((edge) => edge.labelX)
    expect(a).not.toBe(b)

    const disjoint = layoutWorkflowGraph({
      stages: long,
      transitions: [correctionTo('build', 'spec'), correctionTo('merge', 'verify')]
    })
    expect(disjoint.edges[0]!.labelX).toBe(disjoint.edges[1]!.labelX)
  })

  it('widens the canvas for the margins it actually used', () => {
    const bare = layoutWorkflowGraph({ stages: SPINE, transitions: [forwardTo('spec', 'build')] })
    const arced = layoutWorkflowGraph({
      stages: SPINE,
      transitions: [correctionTo('review', 'spec')]
    })
    expect(arced.width).toBeGreaterThan(bare.width)
  })

  it('reports an edge with an endpoint off the graph rather than drawing it', () => {
    const layout = layoutWorkflowGraph({ stages: SPINE, transitions: [forwardTo('spec', 'ghost')] })
    expect(layout.edges).toEqual([])
    expect(layout.danglingTransitions).toHaveLength(1)
  })

  it('lays out an empty graph without producing a negative box', () => {
    const layout = layoutWorkflowGraph({ stages: [], transitions: [] })
    expect(layout.height).toBeGreaterThan(0)
    expect(layout.stages).toEqual([])
  })

  it('keys an edge by its pair, which the contract already makes unique', () => {
    expect(transitionId({ from: 'review', to: 'build' })).toBe('review->build')
  })
})
