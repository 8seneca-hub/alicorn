import { describe, expect, it } from 'vitest'
import { backendFromWorkerStartOptions } from './backend-from-start-options'

describe('backendFromWorkerStartOptions', () => {
  it('reads a known backend from the agent field', () => {
    expect(backendFromWorkerStartOptions('{"agent":"codex"}')).toBe('codex')
    expect(backendFromWorkerStartOptions('{"agent":"claude"}')).toBe('claude')
  })

  it('classifies an agent Alicorn does not price as other', () => {
    expect(backendFromWorkerStartOptions('{"agent":"aider"}')).toBe('other')
  })

  it('returns other rather than throwing on absent or unusable options', () => {
    expect(backendFromWorkerStartOptions(null)).toBe('other')
    expect(backendFromWorkerStartOptions(undefined)).toBe('other')
    expect(backendFromWorkerStartOptions('')).toBe('other')
    expect(backendFromWorkerStartOptions('not json')).toBe('other')
    expect(backendFromWorkerStartOptions('{}')).toBe('other')
    expect(backendFromWorkerStartOptions('{"agent":42}')).toBe('other')
  })
})
