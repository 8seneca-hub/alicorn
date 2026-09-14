// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactI18Next from 'react-i18next'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { Project } from '../../../shared/alicorn/projects'
import type { Task } from '../../../shared/alicorn/tasks'
import WorktreeJumpPalette from './WorktreeJumpPalette'
import { makeRepo, makeWorktree } from './worktree-jump-palette-test-fixtures'

const { activateAndRevealWorktree } = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(() => false)
}))

vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree }))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18Next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key
    })
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn()
  }
}))

vi.mock('@/hooks/useSettingsNavigationMetadata', () => ({
  useSettingsNavigationMetadata: () => []
}))

vi.mock('@/components/sidebar/StatusIndicator', () => ({
  default: () => <span data-status-indicator="true" />
}))

vi.mock('@/components/repo/RepoBadgeLabel', () => ({
  RepoBadgeMark: () => <span data-repo-badge-mark="true" />
}))

vi.mock('@/components/cmd-j/palette-host-badge', () => ({
  getPaletteHostBadge: () => null
}))

// Why: activation reaches into window.api and the whole worktree-reveal path; the palette's own
// contract is which result it hands over, so stub the boundary and assert on that.
const { activateWorkspaceTabPaletteResult } = vi.hoisted(() => ({
  activateWorkspaceTabPaletteResult: vi.fn((_result: unknown) => ({ status: 'activated' }) as const)
}))
vi.mock('@/lib/workspace-tab-palette-activation', () => ({
  activateWorkspaceTabPaletteResult: (result: unknown) => activateWorkspaceTabPaletteResult(result)
}))

vi.mock('@/components/ui/command', async () => {
  const React = await import('react')
  return {
    // Why the commandProps passthrough: cmdk resolves Enter against its `value`, so the controlled
    // value is the only honest stand-in for "what would Enter activate" without mounting real cmdk.
    CommandDialog: ({
      children,
      open,
      commandProps
    }: {
      children: React.ReactNode
      open?: boolean
      commandProps?: { value?: string; onValueChange?: (next: string) => void }
    }) => {
      return open ? (
        <div data-command-dialog="true" data-command-value={commandProps?.value ?? ''}>
          {children}
        </div>
      ) : null
    },
    Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CommandInput: React.forwardRef(function CommandInput(
      {
        value,
        onValueChange,
        placeholder,
        onClick,
        onSelect,
        onKeyDown
      }: {
        value?: string
        onValueChange?: (next: string) => void
        placeholder?: string
        onClick?: React.MouseEventHandler<HTMLInputElement>
        onSelect?: React.ReactEventHandler<HTMLInputElement>
        onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
      },
      ref: React.ForwardedRef<HTMLInputElement>
    ) {
      setCommandQuery = onValueChange ?? null
      return (
        <input
          ref={ref}
          data-command-input="true"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange?.(event.currentTarget.value)}
          onClick={onClick}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      )
    }),
    CommandList: React.forwardRef(function CommandList(
      { children }: { children: React.ReactNode },
      ref: React.ForwardedRef<HTMLDivElement>
    ) {
      return (
        <div ref={ref} data-command-list="true">
          {children}
        </div>
      )
    }),
    CommandEmpty: ({ children }: { children: React.ReactNode }) => (
      <div data-command-empty="true">{children}</div>
    ),
    CommandItem: ({
      children,
      onSelect,
      value
    }: {
      children: React.ReactNode
      onSelect?: (value: string) => void
      value?: string
    }) => (
      <button data-command-item={value ?? ''} onClick={() => onSelect?.(value ?? '')} type="button">
        {children}
      </button>
    )
  }
})

const initialAppState = useAppStore.getInitialState()
let testRoot: Root
let testContainer: HTMLDivElement
let setCommandQuery: ((next: string) => void) | null = null

async function flushEffects(): Promise<void> {
  // The board is two chained reads (projects, then each project's tasks), so one microtask turn
  // is not enough to see the rows the palette ends up with.
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const PROJECT: Project = {
  id: 'proj-1',
  tenantId: 'local',
  name: 'Alicorn',
  key: 'ALC',
  context: '',
  repoIds: ['repo-1'],
  source: null,
  createdBy: 'local',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

function makeTask(number: number, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${number}`,
    tenantId: 'local',
    projectId: PROJECT.id,
    number,
    title,
    context: '',
    column: 'todo',
    executionStrategy: 'single',
    workflowId: null,
    stageKey: null,
    skippedStageKeys: [],
    model: null,
    memberIds: [],
    source: null,
    createdBy: 'local',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    closedAt: null,
    ...overrides
  }
}

const TASKS: Task[] = [
  makeTask(1, 'Wire the ledger outbox drainer', {
    updatedAt: '2026-09-02T00:00:00.000Z'
  }),
  makeTask(2, 'The palette searches tasks', { updatedAt: '2026-09-03T00:00:00.000Z' }),
  makeTask(3, 'Archive the old board', {
    column: 'completed',
    updatedAt: '2026-09-04T00:00:00.000Z'
  })
]

function installAlicornApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    alicorn: {
      listProjects: () => Promise.resolve({ ok: true, projects: [PROJECT] }),
      listTasks: () => Promise.resolve({ ok: true, tasks: TASKS })
    }
  }
}

function taskRowRefs(): string[] {
  return [...testContainer.querySelectorAll<HTMLElement>('[data-command-item^="task:"]')].map(
    (node) => node.textContent?.match(/ALC-\d+/)?.[0] ?? ''
  )
}

async function typeQuery(query: string): Promise<void> {
  expect(setCommandQuery).not.toBeNull()
  await act(async () => {
    setCommandQuery?.(query)
  })
  await flushEffects()
}

async function renderPalette(overrides: Partial<AppState>): Promise<void> {
  useAppStore.setState({
    activeModal: 'worktree-palette',
    activeWorktreeId: null,
    repos: [makeRepo()],
    tabsByWorktree: {},
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {},
    unifiedTabsByWorktree: {},
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    // Why explicit: the sweep exemption is what these cases probe, so it must
    // not ride on whatever the store default happens to be.
    alwaysShowDefaultBranchWorkspace: true,
    lastVisitedAtByWorktreeId: {},
    ...overrides
  } as Partial<AppState>)

  await act(async () => {
    testRoot.render(<WorktreeJumpPalette />)
  })
  await flushEffects()
}

function getWorktreeRows(): string[] {
  return [...testContainer.querySelectorAll<HTMLElement>('[data-command-item*="worktree:"]')].map(
    (node) => node.textContent ?? ''
  )
}

describe('WorktreeJumpPalette', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    installAlicornApi()
    setCommandQuery = null
    activateAndRevealWorktree.mockClear()
    useAppStore.setState(initialAppState, true)
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
    testRoot = createRoot(testContainer)
  })

  afterEach(async () => {
    await act(async () => {
      testRoot.unmount()
    })
    document.body.replaceChildren()
    useAppStore.setState(initialAppState, true)
    delete (window as unknown as { api?: unknown }).api
  })

  it('lists the board on an empty query, newest change first', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })

    expect(taskRowRefs()).toEqual(['ALC-2', 'ALC-1'])
    expect(testContainer.textContent).toContain('Open Tasks')
  })

  it('keeps a completed task out of the untyped list but still findable', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })

    expect(taskRowRefs()).not.toContain('ALC-3')
    await typeQuery('archive')
    expect(taskRowRefs()).toEqual(['ALC-3'])
  })

  it('finds a task by the reference a person calls it', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })

    await typeQuery('ALC-2')

    expect(taskRowRefs()).toEqual(['ALC-2'])
  })

  it('matches title words in any order', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })

    await typeQuery('palette the')

    expect(taskRowRefs()).toEqual(['ALC-2'])
  })

  it('no longer offers worktrees, typed or not', async () => {
    await renderPalette({
      worktreesByRepo: { 'repo-1': [makeWorktree('feature-wt', 'Feature workspace')] },
      showSleepingWorkspaces: true
    })

    expect(getWorktreeRows()).toEqual([])
    expect(testContainer.textContent).not.toContain('Recent Worktrees')

    await typeQuery('Feature workspace')

    // The only row a workspace name reaches now is "create one" — never a jump to an existing.
    expect(getWorktreeRows()).toEqual([])
  })

  it('hands a selected task to the Alicorn shell to open', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })

    const row = testContainer.querySelector<HTMLButtonElement>('[data-command-item="task:task-2"]')
    expect(row).not.toBeNull()
    await act(async () => {
      row!.click()
    })

    expect(useAppStore.getState().pendingAlicornTask).toEqual({
      projectId: 'proj-1',
      taskId: 'task-2'
    })
    expect(useAppStore.getState().activeView).toBe('alicorn')
  })

  it('replaces a completed emoji shortcode in the search query', async () => {
    await renderPalette({ worktreesByRepo: { 'repo-1': [] } })
    const input = testContainer.querySelector<HTMLInputElement>('[data-command-input="true"]')
    expect(input).not.toBeNull()

    await act(async () => {
      fireEvent.change(input!, { target: { value: ':wink:', selectionStart: 6 } })
    })

    expect(input?.value).toBe('😉')
  })
})
