import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('dispatch ledger methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns null for an unknown dispatch', () => {
    expect(db.getDispatchLedgerOutcome('missing')).toBeNull()
  })

  it('round-trips a dispatch to outcome id mapping', () => {
    db.setDispatchLedgerOutcome('ctx_1', 'so_1')

    expect(db.getDispatchLedgerOutcome('ctx_1')).toBe('so_1')
  })

  it('replaces on a repeated set for the same dispatch', () => {
    db.setDispatchLedgerOutcome('ctx_2', 'so_1')
    db.setDispatchLedgerOutcome('ctx_2', 'so_2')

    expect(db.getDispatchLedgerOutcome('ctx_2')).toBe('so_2')
  })
})
