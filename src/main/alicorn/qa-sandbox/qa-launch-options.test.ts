import { describe, expect, it } from 'vitest'
import { isQaLaunchUnsupported, qaLaunchOptions } from './qa-launch-options'

describe('qaLaunchOptions', () => {
  it.each(['claude', 'openclaude'] as const)('marks a %s pane as QA', (backend) => {
    const options = qaLaunchOptions(backend)
    expect(isQaLaunchUnsupported(options)).toBe(false)
    expect(isQaLaunchUnsupported(options) ? null : options.env.ALICORN_ROLE).toBe('qa')
  })

  // Refusing is the point: an ungated QA member reads the implementation and nothing records it.
  it.each(['codex', 'grok'] as const)('refuses %s, which cannot gate its tool calls', (backend) => {
    const options = qaLaunchOptions(backend)
    expect(isQaLaunchUnsupported(options)).toBe(true)
    expect(isQaLaunchUnsupported(options) ? options.reason : '').toContain('blindfolded QA member')
  })
})
