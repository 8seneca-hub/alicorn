// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RunView } from './RunView'
import { useAppStore } from '@/store'
import type {
  ForemanPlanNode,
  ForemanRunViewResult
} from '../../../../../shared/alicorn/foreman-run'
import type { RunCostByDispatch } from '../../../../../shared/alicorn/run-cost'

const getForemanRun = vi.fn<() => Promise<ForemanRunViewResult>>()
let costs: RunCostByDispatch = {}

vi.mock('@/store/alicorn-run-cost-store', () => ({
  subscribeAlicornRunCost: () => () => {},
  getAlicornRunCostSnapshot: () => costs
}))

function node(overrides: Partial<ForemanPlanNode> & { id: string }): ForemanPlanNode {
  return {
    title: `Node ${overrides.id}`,
    owner: 'builder',
    dependsOn: [],
    status: 'pending',
    model: null,
    dispatchId: null,
    ...overrides
  }
}

// The template's own four-node example: orient, two builders against a contract, then review.
const PLAN: ForemanPlanNode[] = [
  node({
    id: '1',
    title: 'orient — map the area',
    owner: 'scout',
    status: 'done',
    model: 'haiku',
    dispatchId: 'ctx_1'
  }),
  node({
    id: '2',
    title: 'backend endpoint',
    owner: 'builder',
    status: 'dispatched',
    model: 'opus',
    dispatchId: 'ctx_2',
    dependsOn: ['1']
  }),
  node({
    id: '3',
    title: 'frontend, against contract',
    owner: 'builder',
    status: 'failed',
    model: 'opus',
    dispatchId: 'ctx_3',
    dependsOn: ['1']
  }),
  node({
    id: '4',
    title: 'review',
    owner: 'reviewer — not the author',
    status: 'pending',
    model: 'codex/sonnet',
    dependsOn: ['2', '3']
  })
]

const READY: ForemanRunViewResult = {
  state: 'ready',
  run: {
    runId: 'run_alc42',
    objective: 'Ship partial refunds end to end.',
    status: 'running',
    startedAt: '2026-09-07T00:00:00.000Z',
    budgetCents: 5_000,
    plan: PLAN
  }
}

function seed(result: ForemanRunViewResult, runCosts: RunCostByDispatch = {}): void {
  costs = runCosts
  getForemanRun.mockResolvedValue(result)
  useAppStore.setState({ activeWorktreeId: 'repo::wt' } as never)
  ;(window as unknown as { api: unknown }).api = { alicorn: { getForemanRun } }
}

beforeEach(() => {
  getForemanRun.mockReset()
  costs = {}
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The app mounts one TooltipProvider at its root (STYLEGUIDE, *Tooltips*); the cost meter's
// tooltip needs it here too.
function renderRunView(props: { isVisible?: boolean } = {}) {
  return render(
    <TooltipProvider>
      <RunView {...props} />
    </TooltipProvider>
  )
}

describe('RunView', () => {
  it('draws every plan node with its owner, model and dependencies', async () => {
    seed(READY)
    renderRunView()

    await waitFor(() => expect(screen.getByText('orient — map the area')).toBeInTheDocument())
    expect(screen.getByText('backend endpoint')).toBeInTheDocument()
    expect(screen.getByText('frontend, against contract')).toBeInTheDocument()
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('reviewer — not the author')).toBeInTheDocument()
    expect(screen.getByText('codex/sonnet')).toBeInTheDocument()
    expect(screen.getByText('after 2, 3')).toBeInTheDocument()
  })

  // Why: a row says `after 2, 3`, so the ids those refer to have to be on screen or the dependency
  // cannot be followed by eye. Asserting the dependency string alone missed this.
  it('shows each node id, so a dependency can be resolved to a row', async () => {
    seed(READY)
    renderRunView()

    await waitFor(() => expect(screen.getByText('after 2, 3')).toBeInTheDocument())
    for (const id of ['1', '2', '3', '4']) {
      expect(screen.getByText(id)).toBeInTheDocument()
    }
  })

  it('shows the run status and objective', async () => {
    seed(READY)
    renderRunView()

    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument())
    expect(screen.getByText('Ship partial refunds end to end.')).toBeInTheDocument()
    expect(screen.getByText('run_alc42')).toBeInTheDocument()
  })

  it('marks each node with its status', async () => {
    seed(READY)
    renderRunView()

    await waitFor(() => expect(screen.getByLabelText('done')).toBeInTheDocument())
    expect(screen.getByLabelText('dispatched')).toBeInTheDocument()
    expect(screen.getByLabelText('failed')).toBeInTheDocument()
    expect(screen.getAllByLabelText('pending')).toHaveLength(1)
  })

  it('totals the cost when every dispatch is priced', async () => {
    seed(READY, {
      ctx_1: { costUsd: 1.5, status: 'known' },
      ctx_2: { costUsd: 2.25, status: 'known' },
      ctx_3: { costUsd: 0.25, status: 'known' }
    })
    renderRunView()

    await waitFor(() => expect(screen.getByTestId('run-view-cost')).toHaveTextContent('$4.00'))
  })

  // Why: CLAUDE.md prices Claude Code and Codex and shows "—" for the rest rather than guessing.
  // A run mixing the two must not present a partial total as the total.
  it('reads as a floor when one dispatch cannot be priced', async () => {
    seed(READY, {
      ctx_1: { costUsd: 1.5, status: 'known' },
      ctx_2: { costUsd: 2.25, status: 'known' },
      ctx_3: { costUsd: null, status: 'unavailable' }
    })
    renderRunView()

    await waitFor(() =>
      expect(screen.getByTestId('run-view-cost')).toHaveTextContent('≥ $3.75 (partial)')
    )
  })

  // A dispatch the cost store has not mentioned is not zero.
  it('reads as a floor when a dispatch is missing from the store', async () => {
    seed(READY, { ctx_1: { costUsd: 1.5, status: 'known' } })
    renderRunView()

    await waitFor(() =>
      expect(screen.getByTestId('run-view-cost')).toHaveTextContent('≥ $1.50 (partial)')
    )
  })

  it('shows a dash when nothing is priced yet', async () => {
    seed(READY, {
      ctx_1: { costUsd: null, status: 'pending' },
      ctx_2: { costUsd: null, status: 'pending' },
      ctx_3: { costUsd: null, status: 'pending' }
    })
    renderRunView()

    await waitFor(() => expect(screen.getByText('orient — map the area')).toBeInTheDocument())
    expect(screen.getByTestId('run-view-cost')).toHaveTextContent('—')
  })

  it('says so when the workspace is running nothing orchestrated', async () => {
    seed({ state: 'none' })
    renderRunView()

    await waitFor(() => expect(screen.getByText(/No orchestrated run/)).toBeInTheDocument())
  })

  // Why the reason is shown: a journal that does not parse names the section to look in, and the
  // journal is hand-editable, so the user is the one who can fix it.
  it('surfaces why a journal could not be read', async () => {
    seed({ state: 'unreadable', reason: 'Plan: row 3 has 5 cells, expected 7' })
    renderRunView()

    await waitFor(() =>
      expect(screen.getByText('Plan: row 3 has 5 cells, expected 7')).toBeInTheDocument()
    )
  })

  it('reads nothing while the panel is closed', async () => {
    seed(READY)
    renderRunView({ isVisible: false })

    await waitFor(() => expect(screen.getByText(/Reading the journal/)).toBeInTheDocument())
    expect(getForemanRun).not.toHaveBeenCalled()
  })

  it('degrades to no run when the api bridge is absent', async () => {
    useAppStore.setState({ activeWorktreeId: 'repo::wt' } as never)
    ;(window as unknown as { api: unknown }).api = {}
    renderRunView()

    await waitFor(() => expect(screen.getByText(/No orchestrated run/)).toBeInTheDocument())
  })
})
