import { describe, expect, it } from 'vitest'
import { unwrapRpcResult } from './mcp'

describe('unwrapRpcResult', () => {
  it('hands the model the payload, not the envelope', () => {
    expect(unwrapRpcResult({ id: 'req-1', ok: true, result: { task: { id: 'tsk_1' } } })).toEqual({
      task: { id: 'tsk_1' }
    })
  })

  it('answers an empty object for a result-less success, not the envelope', () => {
    expect(unwrapRpcResult({ id: 'req-1', ok: true })).toEqual({})
  })

  it('passes through a bare payload from a transport that already unwrapped', () => {
    expect(unwrapRpcResult({ projects: [] })).toEqual({ projects: [] })
  })

  it('treats a non-object answer as nothing rather than throwing', () => {
    expect(unwrapRpcResult(null)).toEqual({})
    expect(unwrapRpcResult('nope')).toEqual({})
  })
})
