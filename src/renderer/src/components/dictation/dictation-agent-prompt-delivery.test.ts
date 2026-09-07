import { describe, expect, it } from 'vitest'
import {
  decideAgentPromptDelivery,
  resolveAgentPromptTarget
} from './dictation-agent-prompt-delivery'
import type { DictationInsertionTarget } from './dictation-insertion-target'

const TERMINAL: DictationInsertionTarget = { kind: 'terminal', tabId: 'tab-1', paneId: 0 }

function state(
  tab: { id: string; launchAgent?: string },
  ptyIds: string[]
): Parameters<typeof resolveAgentPromptTarget>[0] {
  return { tabsByWorktree: { 'wt-1': [tab] }, ptyIdsByTabId: { [tab.id]: ptyIds } }
}

describe('resolveAgentPromptTarget', () => {
  it('resolves a single-pane agent tab to its pty', () => {
    expect(
      resolveAgentPromptTarget(state({ id: 'tab-1', launchAgent: 'claude' }, ['pty-1']), TERMINAL)
    ).toEqual({ tabId: 'tab-1', ptyId: 'pty-1' })
  })

  it('declines a terminal that was not launched with an agent', () => {
    expect(resolveAgentPromptTarget(state({ id: 'tab-1' }, ['pty-1']), TERMINAL)).toBeNull()
  })

  // Why: a split inside an agent tab can be a plain shell, and the target carries the DOM's
  // numeric pane id, not the pane key's leaf id — so a focused shell is indistinguishable here.
  it('declines a split agent tab rather than guess which pane is focused', () => {
    expect(
      resolveAgentPromptTarget(
        state({ id: 'tab-1', launchAgent: 'claude' }, ['pty-1', 'pty-2']),
        TERMINAL
      )
    ).toBeNull()
  })

  it('declines a tab with no live pty', () => {
    expect(
      resolveAgentPromptTarget(state({ id: 'tab-1', launchAgent: 'claude' }, []), TERMINAL)
    ).toBeNull()
  })

  it('declines a non-terminal target', () => {
    expect(
      resolveAgentPromptTarget(state({ id: 'tab-1', launchAgent: 'claude' }, ['pty-1']), {
        kind: 'text',
        element: { value: '' } as HTMLInputElement
      })
    ).toBeNull()
  })

  it('declines when there is no target', () => {
    expect(
      resolveAgentPromptTarget(state({ id: 'tab-1', launchAgent: 'claude' }, ['pty-1']), null)
    ).toBeNull()
  })

  it('declines a tab id that is not in the store', () => {
    expect(
      resolveAgentPromptTarget(state({ id: 'other', launchAgent: 'claude' }, ['pty-1']), TERMINAL)
    ).toBeNull()
  })
})

const BASE = {
  buffer: 'add a test for the parser',
  sessionErrored: false,
  destructive: false,
  confirmBeforeDestructive: true
}

describe('decideAgentPromptDelivery', () => {
  it('submits a clean, non-destructive transcript', () => {
    expect(decideAgentPromptDelivery(BASE)).toBe('submit')
  })

  it('asks first when the transcript is destructive', () => {
    expect(decideAgentPromptDelivery({ ...BASE, destructive: true })).toBe('confirm')
  })

  // Why: opting out must be explicit, so a profile written before the setting existed still confirms.
  it('still confirms when the setting is absent', () => {
    expect(
      decideAgentPromptDelivery({ ...BASE, destructive: true, confirmBeforeDestructive: undefined })
    ).toBe('confirm')
  })

  it('submits destructive text once the user has turned confirmation off', () => {
    expect(
      decideAgentPromptDelivery({ ...BASE, destructive: true, confirmBeforeDestructive: false })
    ).toBe('submit')
  })

  // Why: a truncated transcript submitted to an agent is worse than one that never arrives.
  it('discards the buffer when the session errored', () => {
    expect(decideAgentPromptDelivery({ ...BASE, sessionErrored: true })).toBe('discard')
  })

  it('discards an errored session even when it looks destructive', () => {
    expect(decideAgentPromptDelivery({ ...BASE, sessionErrored: true, destructive: true })).toBe(
      'discard'
    )
  })

  it('discards an empty or whitespace-only buffer', () => {
    expect(decideAgentPromptDelivery({ ...BASE, buffer: '' })).toBe('discard')
    expect(decideAgentPromptDelivery({ ...BASE, buffer: '   \n ' })).toBe('discard')
  })
})
