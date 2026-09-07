import { describe, expect, it } from 'vitest'
import { classifyDictation } from './dictation-intent'
import type { DictationInsertionTarget } from './dictation-insertion-target'

const AGENT_TERMINAL: DictationInsertionTarget = { kind: 'terminal', tabId: 'tab-1', paneId: 0 }
const TEXT_FIELD: DictationInsertionTarget = {
  kind: 'text',
  element: { value: '' } as HTMLInputElement
}

describe('classifyDictation — routing', () => {
  it('routes an agent pane to the agent as a prompt', () => {
    expect(
      classifyDictation('add a test for the parser', AGENT_TERMINAL, { isAgentSession: true }).route
    ).toBe('agent_prompt')
  })

  // Why: a plain shell is not an agent — typing into its PTY is the legacy behaviour and stays.
  it('inserts into a terminal that is not an agent session', () => {
    expect(classifyDictation('git status', AGENT_TERMINAL, { isAgentSession: false }).route).toBe(
      'insert'
    )
  })

  it('inserts into a text field even when an agent is running elsewhere', () => {
    expect(classifyDictation('some notes', TEXT_FIELD, { isAgentSession: true }).route).toBe(
      'insert'
    )
  })

  it('inserts when there is no target at all', () => {
    expect(classifyDictation('anything', null, { isAgentSession: true }).route).toBe('insert')
  })
})

describe('classifyDictation — destructive intent', () => {
  const destructive = [
    'delete the migration file',
    'drop the users table',
    'remove that directory',
    'rm the build output',
    'reset --hard to origin',
    'force push the branch',
    'deploy to production',
    'destroy the stack'
  ]
  for (const text of destructive) {
    it(`flags "${text}"`, () => {
      expect(classifyDictation(text, AGENT_TERMINAL, { isAgentSession: true }).destructive).toBe(
        true
      )
    })
  }

  const safe = [
    'add a test for the parser',
    'warm the cache',
    'reformat this file',
    'summarise the diff',
    'undelete is not a word we use'
  ]
  for (const text of safe) {
    it(`does not flag "${text}"`, () => {
      expect(classifyDictation(text, AGENT_TERMINAL, { isAgentSession: true }).destructive).toBe(
        false
      )
    })
  }

  // Why word boundaries: 'rm' inside 'warm'/'format' must not gate an ordinary request behind a
  // confirmation dialog — a false positive here trains the user to click through it.
  it('matches on whole words, not substrings', () => {
    expect(
      classifyDictation('format the payload', AGENT_TERMINAL, { isAgentSession: true }).destructive
    ).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(
      classifyDictation('DELETE everything', AGENT_TERMINAL, { isAgentSession: true }).destructive
    ).toBe(true)
  })

  // Why: speech-to-text writes what was said, and nobody dictates the dashes.
  it('accepts the spoken form of the two-word verbs', () => {
    expect(
      classifyDictation('reset hard please', AGENT_TERMINAL, { isAgentSession: true }).destructive
    ).toBe(true)
    expect(
      classifyDictation('force-push it', AGENT_TERMINAL, { isAgentSession: true }).destructive
    ).toBe(true)
  })

  // Why: destructive intent is about the words, not the destination — the confirmation applies
  // to an insert into a live shell just as much as to an agent prompt.
  it('flags destructive text bound for a plain shell too', () => {
    expect(
      classifyDictation('rm the build output', AGENT_TERMINAL, { isAgentSession: false })
    ).toEqual({ route: 'insert', destructive: true })
  })
})
