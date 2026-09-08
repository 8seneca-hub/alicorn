// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvenancePanel } from './ProvenancePanel'
import { useAppStore } from '@/store'
import type {
  ProvenanceStepView,
  ProvenanceView,
  ProvenanceViewResult
} from '../../../../../shared/alicorn/provenance-view'

const getProvenance = vi.fn<() => Promise<ProvenanceViewResult>>()

function step(overrides: Partial<ProvenanceStepView> & { id: string }): ProvenanceStepView {
  return {
    dispatchId: `d_${overrides.id}`,
    runId: 'run_1',
    taskId: 'task_1',
    stageKey: 'build',
    member: 'Developer',
    backend: 'claude',
    executionStrategy: 'single',
    outcome: 'succeeded',
    filesModified: 3,
    spendCents: 61,
    gate: { decision: 'auto', reason: 'auto', gateId: null, agreement: { recorded: false } },
    reportSummary: '',
    createdAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  }
}

function view(overrides: Partial<ProvenanceView> = {}): ProvenanceView {
  const steps = overrides.steps ?? [step({ id: 'a' })]
  const gateCounts = { gate: 0, auto: 0, unknown: 0 }
  for (const entry of steps) {
    gateCounts[entry.gate.decision] += 1
  }
  return {
    // PV2 counts agreement beside the gate decisions; this fixture records none.
    agreementCounts: { agreed: 0, disagreed: 0, unrecorded: steps.length },
    repoId: 'repo',
    branch: 'feature/x',
    totals: { tasks: steps.length, dispatches: steps.length, spendCents: 61 },
    steps,
    checks: [],
    reviewerRule: 'enforced',
    escalation: { offered: false },
    contextCaptureCount: 1,
    gateCounts,
    ...overrides
  }
}

function seed(result: ProvenanceViewResult | null, branch = 'refs/heads/feature/x'): void {
  if (result) {
    getProvenance.mockResolvedValue(result)
  }
  useAppStore.setState({
    activeWorktreeId: 'repo::wt',
    activeWorkspaceExecutionHostId: null,
    getKnownWorktreeById: () => ({ id: 'repo::wt', repoId: 'repo', branch })
  } as never)
  ;(window as unknown as { api: unknown }).api = { alicorn: { getProvenance } }
}

beforeEach(() => {
  getProvenance.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ProvenancePanel', () => {
  it('answers why no human was asked, naming the rule that decided', async () => {
    seed({ ok: true, view: view() })
    render(<ProvenancePanel />)

    await waitFor(() => expect(screen.getByText('No human asked')).toBeInTheDocument())
    expect(screen.getByText(/Every condition passed/)).toBeInTheDocument()
  })

  it('names a hard stop as a hard stop rather than as a policy choice', async () => {
    seed({
      ok: true,
      view: view({
        steps: [
          step({ id: 'a', stageKey: 'merge', gate: { decision: 'gate', reason: 'irreversible', gateId: null, agreement: { recorded: false } } })
        ]
      })
    })
    render(<ProvenancePanel />)

    await waitFor(() => expect(screen.getByText('Human asked')).toBeInTheDocument())
    expect(screen.getByText(/authored irreversible/)).toBeInTheDocument()
    expect(screen.getByText(/evidence never retires it/)).toBeInTheDocument()
  })

  it('says a step carries no decision instead of implying it was automatic', async () => {
    seed({
      ok: true,
      view: view({ steps: [step({ id: 'a', gate: { decision: 'unknown', reason: 'unknown', gateId: null, agreement: { recorded: false } } })] })
    })
    render(<ProvenancePanel />)

    await waitFor(() => expect(screen.getByText('Not recorded')).toBeInTheDocument())
    expect(screen.getByText(/cannot say whether a human was asked/)).toBeInTheDocument()
  })

  it('shows an em dash for a step it cannot price rather than a zero', async () => {
    seed({
      ok: true,
      view: view({ steps: [step({ id: 'a', member: null, spendCents: null })] })
    })
    render(<ProvenancePanel />)

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0))
  })

  it('warns when the reviewer ran on the author backend', async () => {
    seed({ ok: true, view: view({ reviewerRule: 'bypassed' }) })
    render(<ProvenancePanel />)

    await waitFor(() =>
      expect(screen.getByTestId('provenance-reviewer-rule')).toHaveTextContent(
        /Reviewer backend rule bypassed/
      )
    )
  })

  it('distinguishes a rule that is off from a rule that passed', async () => {
    seed({ ok: true, view: view({ reviewerRule: 'not-enforced' }) })
    render(<ProvenancePanel />)

    await waitFor(() =>
      expect(screen.getByTestId('provenance-reviewer-rule')).toHaveTextContent(
        /not the same as no conflict/
      )
    )
  })

  it('says the checks are missing rather than leaving the section blank', async () => {
    seed({ ok: true, view: view() })
    render(<ProvenancePanel />)

    await waitFor(() =>
      expect(screen.getByText(/No check was recorded against this branch/)).toBeInTheDocument()
    )
  })

  it('names what the record does not carry, instead of guessing it', async () => {
    seed({ ok: true, view: view() })
    render(<ProvenancePanel />)

    await waitFor(() => expect(screen.getByText(/Not in this record/i)).toBeInTheDocument())
    expect(screen.getByText(/run count and accept rate/)).toBeInTheDocument()
  })

  it('claims nothing when the ledger cannot be read', async () => {
    seed({ ok: false, error: 'control_plane_unconfigured' })
    render(<ProvenancePanel />)

    await waitFor(() =>
      expect(screen.getByText(/Nothing is claimed about it either way/)).toBeInTheDocument()
    )
    expect(screen.getByText('control_plane_unconfigured')).toBeInTheDocument()
  })

  it('does not read the ledger for a workspace with no branch', async () => {
    seed(null, '')
    render(<ProvenancePanel />)

    await waitFor(() =>
      expect(screen.getByText(/keys a run by repository and branch/)).toBeInTheDocument()
    )
    expect(getProvenance).not.toHaveBeenCalled()
  })

  it('does not read the ledger while the panel is closed', async () => {
    seed({ ok: true, view: view() })
    render(<ProvenancePanel isVisible={false} />)

    await waitFor(() => expect(screen.getByText(/Reading the ledger…/)).toBeInTheDocument())
    expect(getProvenance).not.toHaveBeenCalled()
  })

  it('asks the ledger for the short branch name, not the full ref', async () => {
    seed({ ok: true, view: view() })
    render(<ProvenancePanel />)

    await waitFor(() => expect(getProvenance).toHaveBeenCalled())
    expect(getProvenance).toHaveBeenCalledWith({ repoId: 'repo', branch: 'feature/x' })
  })
})
