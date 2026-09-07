import { describe, expect, it } from 'vitest'
import { MEMBER_BACKENDS } from '../../../shared/alicorn/members'
import {
  ALICORN_ROLE_ENV,
  LEAD_DISALLOWED_TOOLS,
  isLeadLaunchUnsupported,
  leadLaunchOptions
} from './lead-launch-options'

describe('leadLaunchOptions', () => {
  it('answers for every backend, so a new one cannot be silently unhandled', () => {
    for (const backend of MEMBER_BACKENDS) {
      expect(leadLaunchOptions(backend)).toBeDefined()
    }
  })

  it.each(['claude', 'openclaude'] as const)('restricts writes on %s', (backend) => {
    const options = leadLaunchOptions(backend)
    expect(isLeadLaunchUnsupported(options)).toBe(false)
    if (!isLeadLaunchUnsupported(options)) {
      expect(options.disallowedTools).toEqual([...LEAD_DISALLOWED_TOOLS])
      expect(options.env[ALICORN_ROLE_ENV]).toBe('lead')
    }
  })

  // Why refuse rather than launch anyway: a lead that can quietly write code makes a run look
  // orchestrated while being nothing of the sort.
  it.each(['codex', 'grok'] as const)('refuses %s and says what to do instead', (backend) => {
    const options = leadLaunchOptions(backend)
    expect(isLeadLaunchUnsupported(options)).toBe(true)
    if (isLeadLaunchUnsupported(options)) {
      expect(options.reason).toContain(backend)
      expect(options.reason).toContain('single')
    }
  })

  it('names every write tool the lead must not have', () => {
    expect([...LEAD_DISALLOWED_TOOLS]).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
  })
})
