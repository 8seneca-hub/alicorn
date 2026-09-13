import { describe, expect, it } from 'vitest'
import { describeFailure } from './describe-failure'

describe('describeFailure', () => {
  it('takes an Error at its message', () => {
    expect(describeFailure(new Error('nope'))).toBe('nope')
  })

  it('passes a string straight through', () => {
    expect(describeFailure('control_plane_unreachable')).toBe('control_plane_unreachable')
  })

  // The defect this exists for: IPC answers {ok:false,error}, and String() on it reads
  // "[object Object]" in red on the task screen.
  it('reads the error field of a rejection payload instead of stringifying the object', () => {
    expect(describeFailure({ ok: false, error: 'no_workspace' })).toBe('no_workspace')
    expect(describeFailure({ message: 'boom' })).toBe('boom')
  })

  it('shows an unexpected shape rather than the word object', () => {
    expect(describeFailure({ code: 42 })).toBe('{"code":42}')
  })

  it('never returns an empty line', () => {
    expect(describeFailure(null)).toBe('Unknown failure')
    expect(describeFailure(undefined)).toBe('Unknown failure')
  })
})
