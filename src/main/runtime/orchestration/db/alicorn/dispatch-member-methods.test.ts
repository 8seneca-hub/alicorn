import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('dispatch member methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns undefined for an unknown dispatch', () => {
    expect(db.getDispatchMember('missing')).toBeUndefined()
  })

  it('round-trips a dispatch member with reviewBackendBypass as a boolean', () => {
    db.setDispatchMember({
      dispatchId: 'ctx_1',
      memberId: 'member_1',
      memberRole: 'implementer',
      backend: 'claude_code',
      reviewBackendBypass: true
    })

    const member = db.getDispatchMember('ctx_1')
    expect(member).toEqual({
      dispatchId: 'ctx_1',
      memberId: 'member_1',
      memberRole: 'implementer',
      backend: 'claude_code',
      reviewBackendBypass: true
    })
  })

  it('defaults reviewBackendBypass to false when not set', () => {
    db.setDispatchMember({
      dispatchId: 'ctx_2',
      memberId: 'member_2',
      memberRole: 'reviewer',
      backend: 'codex',
      reviewBackendBypass: false
    })

    expect(db.getDispatchMember('ctx_2')?.reviewBackendBypass).toBe(false)
  })

  it('overwrites on a repeated set for the same dispatch', () => {
    db.setDispatchMember({
      dispatchId: 'ctx_3',
      memberId: 'member_a',
      memberRole: 'implementer',
      backend: 'claude_code',
      reviewBackendBypass: false
    })
    db.setDispatchMember({
      dispatchId: 'ctx_3',
      memberId: 'member_b',
      memberRole: 'reviewer',
      backend: 'codex',
      reviewBackendBypass: true
    })

    expect(db.getDispatchMember('ctx_3')).toEqual({
      dispatchId: 'ctx_3',
      memberId: 'member_b',
      memberRole: 'reviewer',
      backend: 'codex',
      reviewBackendBypass: true
    })
  })
})
