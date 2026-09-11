// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatePanel } from './GatePanel'
import type {
  GateResolveResult,
  PendingGateView,
  PendingGatesResult
} from '../../../../../shared/alicorn/gate-review'

const listPendingGates = vi.fn<() => Promise<PendingGatesResult>>()
const resolveGate = vi.fn<() => Promise<GateResolveResult>>()

function gate(overrides: Partial<PendingGateView> = {}): PendingGateView {
  return {
    id: 'gate_1',
    taskId: 'task_1',
    taskTitle: 'Ship the parser',
    question: 'Merge the branch?',
    options: ['yes'],
    createdAt: '2026-09-08T00:00:00.000Z',
    recommendation: { decision: 'auto', reason: 'auto' },
    policyEvaluated: true,
    autonomyLevel: 1,
    repoId: null,
    ...overrides
  }
}

function seed(result: PendingGatesResult): void {
  listPendingGates.mockResolvedValue(result)
  resolveGate.mockResolvedValue({ ok: true, agreementRecorded: true })
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { listPendingGates, resolveGate }
  }
}

beforeEach(() => {
  listPendingGates.mockReset()
  resolveGate.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('GatePanel', () => {
  it('says nothing is waiting when no gate is pending', async () => {
    seed({ ok: true, gates: [] })
    render(<GatePanel />)
    expect(await screen.findByText(/No gate is waiting on you/)).toBeInTheDocument()
  })

  it('shows the policy recommendation once the member has reached level 1', async () => {
    seed({ ok: true, gates: [gate()] })
    render(<GatePanel />)
    expect(
      await screen.findByText(/would have let this step proceed without asking you/)
    ).toBeInTheDocument()
  })

  it('withholds it below level 1 and says so instead of showing a verdict', async () => {
    seed({ ok: true, gates: [gate({ recommendation: null, autonomyLevel: 0 })] })
    render(<GatePanel />)
    expect(await screen.findByText(/has not run this stage often enough/)).toBeInTheDocument()
    expect(screen.queryByText(/would have let this step proceed/)).not.toBeInTheDocument()
  })

  it('pre-selects neither verdict, so nothing can be accepted by reflex', async () => {
    seed({ ok: true, gates: [gate()] })
    render(<GatePanel />)
    const needed = await screen.findByRole('button', { name: 'Needed me' })
    const proceeded = screen.getByRole('button', { name: 'Could have proceeded' })
    expect(needed).toHaveAttribute('aria-pressed', 'false')
    expect(proceeded).toHaveAttribute('aria-pressed', 'false')
    expect(document.activeElement).not.toBe(needed)
    expect(document.activeElement).not.toBe(proceeded)
  })

  it('will not resolve until the human has made both calls', async () => {
    seed({ ok: true, gates: [gate()] })
    render(<GatePanel />)
    const resolve = await screen.findByRole('button', { name: 'Resolve' })
    expect(resolve).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'yes' }))
    expect(resolve).toBeDisabled() // a resolution alone is not a gate verdict

    fireEvent.click(screen.getByRole('button', { name: 'Could have proceeded' }))
    expect(resolve).toBeEnabled()
  })

  it('sends the resolution and the human’s own gate verdict', async () => {
    seed({ ok: true, gates: [gate()] })
    render(<GatePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Needed me' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(resolveGate).toHaveBeenCalledWith({
        gateId: 'gate_1',
        resolution: 'yes',
        // Disagreeing with the shown recommendation is recorded exactly as agreeing is.
        humanGateDecision: 'gate'
      })
    )
  })

  it('surfaces a failed resolve instead of pretending the gate closed', async () => {
    seed({ ok: true, gates: [gate()] })
    resolveGate.mockResolvedValue({ ok: false, error: 'gate_not_pending' })
    render(<GatePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Could have proceeded' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(await screen.findByText('gate_not_pending')).toBeInTheDocument()
  })

  it('reports a read failure rather than showing an empty list', async () => {
    seed({ ok: false, error: 'gates_unavailable' })
    render(<GatePanel />)
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument()
    expect(screen.getByText('gates_unavailable')).toBeInTheDocument()
  })

  // The queue has to be readable one project at a time once more than one is waiting.
  it('heads each project once two are waiting, and puts the unplaced ones last', async () => {
    seed({
      ok: true,
      gates: [
        gate({ id: 'g1', repoId: null }),
        gate({ id: 'g2', repoId: 'repo-b' }),
        gate({ id: 'g3', repoId: 'repo-a' })
      ]
    })
    render(<GatePanel />)

    await waitFor(() => expect(screen.getAllByTestId('gate-group-header')).toHaveLength(3))
    const headers = screen.getAllByTestId('gate-group-header').map((el) => el.textContent)
    expect(headers[2]).toBe('Not attributed to a project')
  })

  // One project is the common case, and a header over the only group is noise.
  it('renders flat when every gate belongs to the same project', async () => {
    seed({ ok: true, gates: [gate({ id: 'g1', repoId: 'repo-a' })] })
    render(<GatePanel />)

    await waitFor(() => expect(screen.getByTestId('pending-gates')).toBeInTheDocument())
    expect(screen.queryByTestId('gate-group-header')).not.toBeInTheDocument()
  })
})
