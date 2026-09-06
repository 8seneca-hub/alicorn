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
    db.setDispatchLedgerOutcome('ctx_1', 'so_1', [])

    expect(db.getDispatchLedgerOutcome('ctx_1')).toBe('so_1')
  })

  it('replaces on a repeated set for the same dispatch', () => {
    db.setDispatchLedgerOutcome('ctx_2', 'so_1', [])
    db.setDispatchLedgerOutcome('ctx_2', 'so_2', [])

    expect(db.getDispatchLedgerOutcome('ctx_2')).toBe('so_2')
  })

  it('returns a null entry for an unknown dispatch', () => {
    expect(db.getDispatchLedgerEntry('missing')).toBeNull()
  })

  it('round-trips the outcome id and filesModified together', () => {
    db.setDispatchLedgerOutcome('ctx_3', 'so_3', ['a.ts', 'b.ts'])

    expect(db.getDispatchLedgerEntry('ctx_3')).toEqual({
      outcomeId: 'so_3',
      filesModified: ['a.ts', 'b.ts']
    })
  })

  it('returns an empty filesModified when none were reported', () => {
    db.setDispatchLedgerOutcome('ctx_4', 'so_4', [])

    expect(db.getDispatchLedgerEntry('ctx_4')).toEqual({ outcomeId: 'so_4', filesModified: [] })
  })

  it('replaces filesModified on a repeated set for the same dispatch', () => {
    db.setDispatchLedgerOutcome('ctx_5', 'so_1', ['a.ts'])
    db.setDispatchLedgerOutcome('ctx_5', 'so_2', ['b.ts'])

    expect(db.getDispatchLedgerEntry('ctx_5')).toEqual({
      outcomeId: 'so_2',
      filesModified: ['b.ts']
    })
  })
})
