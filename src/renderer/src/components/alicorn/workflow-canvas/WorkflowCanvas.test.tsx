// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../../i18n/i18n'
import { WorkflowCanvas } from './WorkflowCanvas'
import { correctionTo, forwardTo, newStage } from './workflow-draft'
import { validateDraft } from './workflow-draft-validation'
import type { Member } from '../../../../../shared/alicorn/members'

const STAGES = [
  { ...newStage('build', 0), name: 'Build', memberId: 'm1' },
  { ...newStage('review', 1), name: 'Review' },
  {
    ...newStage('merge', 2),
    name: 'Merge',
    reversibility: 'irreversible' as const,
    inheritedCost: 'high' as const
  }
]

const MEMBERS = [{ id: 'm1', name: 'Builder' } as Member]

const TRANSITIONS = [
  forwardTo('build', 'review'),
  forwardTo('review', 'merge'),
  correctionTo('review', 'build')
]

function renderCanvas(over: Partial<Parameters<typeof WorkflowCanvas>[0]> = {}): {
  onSelect: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  render(
    <WorkflowCanvas
      stages={STAGES}
      transitions={TRANSITIONS}
      members={MEMBERS}
      issues={[]}
      selection={null}
      onSelect={onSelect}
      {...over}
    />
  )
  return { onSelect }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('stages', () => {
  it('draws every stage with its key and its member', () => {
    renderCanvas()
    expect(screen.getByText('Build')).toBeInTheDocument()
    expect(screen.getByText('Builder')).toBeInTheDocument()
    // review and merge are both memberless in the fixture, so this is two boxes, not one.
    expect(screen.getAllByText('No member assigned')).toHaveLength(2)
  })

  // Authored, never inferred — and guessing wrong once is a production deploy, so it is on the box.
  it('shows the authored reversibility and inherited cost, and marks the irreversible stage', () => {
    renderCanvas()
    expect(screen.getByText('Irreversible')).toBeInTheDocument()
    expect(screen.getByText('Costly to undo')).toBeInTheDocument()
    expect(screen.getAllByText('Contained')).toHaveLength(2)
    const merge = screen.getByRole('button', { name: /Merge/ })
    expect(merge.className).toContain('border-destructive')
  })

  it('selects the stage that was clicked', async () => {
    const { onSelect } = renderCanvas()
    await userEvent.click(screen.getByRole('button', { name: /Build/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'stage', key: 'build' })
  })
})

describe('the correction edge', () => {
  it('draws it as its own kind of edge, not as a forward one', () => {
    const { container } = render(
      <WorkflowCanvas
        stages={STAGES}
        transitions={TRANSITIONS}
        members={MEMBERS}
        issues={[]}
        selection={null}
        onSelect={vi.fn()}
      />
    )
    const correction = container.querySelector('[data-testid="workflow-edge-review->build"]')
    expect(correction?.getAttribute('data-edge-kind')).toBe('correction')
    const painted = correction?.querySelectorAll('path')[1]
    expect(painted?.getAttribute('class')).toContain('stroke-status-attention')
    // Dashed as well as coloured, so the return reads as different without relying on colour.
    expect(painted?.getAttribute('stroke-dasharray')).toBe('4 3')
    expect(screen.getByText('Correction')).toBeInTheDocument()
  })

  it('leaves a forward edge undashed and in the quiet colour', () => {
    const { container } = render(
      <WorkflowCanvas
        stages={STAGES}
        transitions={TRANSITIONS}
        members={MEMBERS}
        issues={[]}
        selection={null}
        onSelect={vi.fn()}
      />
    )
    const forward = container
      .querySelector('[data-testid="workflow-edge-build->review"]')
      ?.querySelectorAll('path')[1]
    expect(forward?.getAttribute('class')).toContain('stroke-muted-foreground')
    expect(forward?.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('paints an edge the API would reject in the destructive colour', () => {
    const broken = [{ ...correctionTo('build', 'review'), kind: 'correction' as const }]
    const { container } = render(
      <WorkflowCanvas
        stages={STAGES}
        transitions={broken}
        members={MEMBERS}
        issues={validateDraft({ projectId: 'p', name: 'w', stages: STAGES, transitions: broken })}
        selection={null}
        onSelect={vi.fn()}
      />
    )
    const painted = container
      .querySelector('[data-testid="workflow-edge-build->review"]')
      ?.querySelectorAll('path')[1]
    expect(painted?.getAttribute('class')).toContain('stroke-destructive')
  })
})

describe('an empty graph', () => {
  it('says so rather than drawing an empty box', () => {
    render(
      <WorkflowCanvas
        stages={[]}
        transitions={[]}
        members={[]}
        issues={[]}
        selection={null}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText(/No stages yet/)).toBeInTheDocument()
  })
})
