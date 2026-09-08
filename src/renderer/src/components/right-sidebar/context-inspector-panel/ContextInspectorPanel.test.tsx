// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextInspectorPanel } from './ContextInspectorPanel'
import { useAppStore } from '@/store'
import { PROMPT_PREVIEW_CHARS } from '../../../../../shared/alicorn/run-inspector-view'
import type {
  ContextCaptureDetailResult,
  RunInspectorDispatch,
  RunInspectorView,
  RunInspectorViewResult
} from '../../../../../shared/alicorn/run-inspector-view'

// The house pattern for a shadcn Select under happy-dom: Radix's listbox needs pointer capture the
// test environment does not provide, so the primitive is replaced with plain buttons.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      const contextValue = React.useMemo(() => ({ onValueChange }), [onValueChange])
      return (
        <SelectContext.Provider value={contextValue}>
          <div data-slot="run-select" data-value={value}>
            {children}
          </div>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'> & { size?: string }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <button type="button" data-testid={`run-option-${value}`} onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    }
  }
})

const getRunInspector = vi.fn<() => Promise<RunInspectorViewResult>>()
const getContextCapture = vi.fn<() => Promise<ContextCaptureDetailResult>>()

function dispatch(overrides: Partial<RunInspectorDispatch> = {}): RunInspectorDispatch {
  return {
    dispatchId: 'd1',
    taskId: 't1',
    stageKey: 'build',
    member: 'Developer',
    backend: 'claude',
    outcome: 'succeeded',
    gate: { decision: 'auto', reason: 'auto' },
    spendCents: 61,
    filesModified: 3,
    reportSummary: '',
    prompt: { kind: 'inline', bytes: 512 },
    capturedAt: '2026-09-07T00:00:00.000Z',
    checks: [],
    createdAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  }
}

function view(overrides: Partial<RunInspectorView> = {}): RunInspectorView {
  const dispatches = overrides.dispatches ?? [dispatch()]
  return {
    repoId: 'repo',
    branch: 'feature/x',
    runs: [{ runId: 'run_1', startedAt: '2026-09-07T00:00:00.000Z', dispatchCount: 1 }],
    runId: 'run_1',
    dispatches,
    cost: { costUsd: 0.61, partial: false },
    capturesTruncated: false,
    dispatchesOutsideBranch: 0,
    ...overrides
  }
}

function capture(
  overrides: Partial<Extract<ContextCaptureDetailResult, { ok: true }>['capture']> = {}
): ContextCaptureDetailResult {
  return {
    ok: true,
    capture: {
      dispatchId: 'd1',
      createdAt: '2026-09-07T00:00:00.000Z',
      promptBytes: 512,
      prompt: 'the exact prompt a member saw',
      promptPath: null,
      contextSlice: { taskSpec: 'ship it' },
      ...overrides
    }
  }
}

function seed(result: RunInspectorViewResult | null, branch = 'refs/heads/feature/x'): void {
  if (result) {
    getRunInspector.mockResolvedValue(result)
  }
  useAppStore.setState({
    activeWorktreeId: 'repo::wt',
    activeWorkspaceExecutionHostId: null,
    getKnownWorktreeById: () => ({ id: 'repo::wt', repoId: 'repo', branch })
  } as never)
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { getRunInspector, getContextCapture }
  }
}

async function expand(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('context-inspector-dispatch')).toBeInTheDocument())
  fireEvent.click(screen.getByTestId('context-inspector-dispatch'))
}

beforeEach(() => {
  getRunInspector.mockReset()
  getContextCapture.mockReset().mockResolvedValue(capture())
})

afterEach(() => {
  cleanup()
})

describe('ContextInspectorPanel', () => {
  it('shows the exact prompt a dispatch was given, only once it is opened', async () => {
    seed({ ok: true, view: view() })
    render(<ContextInspectorPanel />)

    await waitFor(() => expect(getRunInspector).toHaveBeenCalled())
    expect(getContextCapture).not.toHaveBeenCalled()

    await expand()
    await waitFor(() =>
      expect(screen.getByTestId('captured-prompt-text')).toHaveTextContent(
        'the exact prompt a member saw'
      )
    )
    expect(getContextCapture).toHaveBeenCalledWith({ runId: 'run_1', dispatchId: 'd1' })
  })

  it('says a spilled prompt is on disk and names the file, rather than rendering an empty box', async () => {
    seed({
      ok: true,
      view: view({
        dispatches: [dispatch({ prompt: { kind: 'file', path: '/var/alicorn/prompts/d1.md' } })]
      })
    })
    getContextCapture.mockResolvedValue(
      capture({ prompt: null, promptPath: '/var/alicorn/prompts/d1.md', promptBytes: 0 })
    )
    render(<ContextInspectorPanel />)

    await waitFor(() => expect(screen.getByText('Prompt on disk')).toBeInTheDocument())
    await expand()

    await waitFor(() =>
      expect(screen.getByTestId('captured-prompt-path')).toHaveTextContent(
        '/var/alicorn/prompts/d1.md'
      )
    )
    expect(screen.getByText(/over the 64 KiB the ledger holds inline/)).toBeInTheDocument()
    // The size the ledger stores for a spilled capture is 0, so no size is claimed for it.
    expect(screen.queryByText(/0 bytes/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('captured-prompt-text')).not.toBeInTheDocument()
  })

  it('never reads a capture for a dispatch that recorded none', async () => {
    seed({ ok: true, view: view({ dispatches: [dispatch({ prompt: { kind: 'none' } })] }) })
    render(<ContextInspectorPanel />)

    await waitFor(() => expect(screen.getByText('Not captured')).toBeInTheDocument())
    await expand()

    await waitFor(() =>
      expect(screen.getByText(/underinformed member from a wrong one/)).toBeInTheDocument()
    )
    expect(getContextCapture).not.toHaveBeenCalled()
  })

  it('holds back a very long prompt until asked, saying how much it kept', async () => {
    seed({ ok: true, view: view() })
    getContextCapture.mockResolvedValue(capture({ prompt: 'y'.repeat(PROMPT_PREVIEW_CHARS + 40) }))
    render(<ContextInspectorPanel />)
    await expand()

    await waitFor(() =>
      expect(screen.getByTestId('captured-prompt-text').textContent).toHaveLength(
        PROMPT_PREVIEW_CHARS
      )
    )
    fireEvent.click(screen.getByText(/Show the remaining 40 characters/))
    await waitFor(() =>
      expect(screen.getByTestId('captured-prompt-text').textContent).toHaveLength(
        PROMPT_PREVIEW_CHARS + 40
      )
    )
  })

  it('shows the context slice next to the prompt', async () => {
    seed({ ok: true, view: view() })
    render(<ContextInspectorPanel />)
    await expand()

    await waitFor(() =>
      expect(screen.getByTestId('captured-context-slice')).toHaveTextContent('ship it')
    )
  })

  it('keeps at most one prompt open, so a long run cannot stack bodies in the DOM', async () => {
    seed({
      ok: true,
      view: view({
        dispatches: [dispatch({ dispatchId: 'd1' }), dispatch({ dispatchId: 'd2' })]
      })
    })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getAllByTestId('context-inspector-dispatch')).toHaveLength(2)
    )
    fireEvent.click(screen.getAllByTestId('context-inspector-dispatch')[0]!)
    await waitFor(() => expect(screen.getAllByTestId('captured-prompt-text')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('context-inspector-dispatch')[1]!)
    await waitFor(() => expect(screen.getAllByTestId('captured-prompt-text')).toHaveLength(1))
  })

  it('shows a partial run cost as a floor rather than as a figure', async () => {
    seed({ ok: true, view: view({ cost: { costUsd: 2.5, partial: true } }) })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('context-inspector-totals')).toHaveTextContent(
        '≥ $2.50 (partial)'
      )
    )
  })

  it('shows an em dash rather than a zero when it cannot price the run', async () => {
    seed({ ok: true, view: view({ cost: { costUsd: null, partial: false } }) })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('context-inspector-totals')).toHaveTextContent('—')
    )
  })

  it('says the capture list was capped instead of letting the run look short', async () => {
    seed({ ok: true, view: view({ capturesTruncated: true }) })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('context-inspector-truncated')).toHaveTextContent(
        /more captures than the ledger returns/
      )
    )
  })

  it('says when the run reaches beyond this branch, so a slice does not read as the run', async () => {
    seed({ ok: true, view: view({ dispatchesOutsideBranch: 4 }) })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('context-inspector-outside')).toHaveTextContent(
        /4 dispatches outside this branch/
      )
    )
  })

  it('re-reads the branch for the run a reader picks', async () => {
    seed({
      ok: true,
      view: view({
        runs: [
          { runId: 'run_2', startedAt: '2026-09-07T00:00:00.000Z', dispatchCount: 1 },
          { runId: 'run_1', startedAt: '2026-09-06T00:00:00.000Z', dispatchCount: 2 }
        ]
      })
    })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('context-inspector-run-select')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('run-option-run_1'))
    await waitFor(() =>
      expect(getRunInspector).toHaveBeenCalledWith({
        repoId: 'repo',
        branch: 'feature/x',
        runId: 'run_1'
      })
    )
  })

  it('claims nothing when the ledger cannot be read', async () => {
    seed({ ok: false, error: 'control_plane_unconfigured' })
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByText(/Nothing is claimed about it either way/)).toBeInTheDocument()
    )
    expect(screen.getByText('control_plane_unconfigured')).toBeInTheDocument()
  })

  it('claims nothing about a dispatch whose capture cannot be read', async () => {
    seed({ ok: true, view: view() })
    getContextCapture.mockResolvedValue({ ok: false, error: 'not_found' })
    render(<ContextInspectorPanel />)
    await expand()

    await waitFor(() =>
      expect(screen.getByText(/Nothing is claimed about what this dispatch was given/)).toBeInTheDocument()
    )
  })

  it('does not read the ledger for a workspace with no branch', async () => {
    seed(null, '')
    render(<ContextInspectorPanel />)

    await waitFor(() =>
      expect(screen.getByText(/keys a run by repository and branch/)).toBeInTheDocument()
    )
    expect(getRunInspector).not.toHaveBeenCalled()
  })

  it('does not read the ledger while the panel is closed', async () => {
    seed({ ok: true, view: view() })
    render(<ContextInspectorPanel isVisible={false} />)

    await waitFor(() => expect(screen.getByText(/Reading the ledger…/)).toBeInTheDocument())
    expect(getRunInspector).not.toHaveBeenCalled()
  })

  it('asks for the short branch name, not the full ref', async () => {
    seed({ ok: true, view: view() })
    render(<ContextInspectorPanel />)

    await waitFor(() => expect(getRunInspector).toHaveBeenCalled())
    expect(getRunInspector).toHaveBeenCalledWith({
      repoId: 'repo',
      branch: 'feature/x',
      runId: null
    })
  })
})
