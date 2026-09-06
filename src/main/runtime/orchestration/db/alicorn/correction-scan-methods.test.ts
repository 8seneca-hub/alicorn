import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('correction scan methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns null for an unknown worktree', () => {
    expect(db.getCorrectionScan('missing')).toBeNull()
  })

  it('round-trips a scan with a last commit', () => {
    db.setCorrectionScan('wt_1', '2026-09-06T00:00:00.000Z', 'abc123')

    expect(db.getCorrectionScan('wt_1')).toEqual({
      lastScannedAt: '2026-09-06T00:00:00.000Z',
      lastCommit: 'abc123'
    })
  })

  it('allows a null last commit', () => {
    db.setCorrectionScan('wt_2', '2026-09-06T00:00:00.000Z', null)

    expect(db.getCorrectionScan('wt_2')).toEqual({
      lastScannedAt: '2026-09-06T00:00:00.000Z',
      lastCommit: null
    })
  })

  it('overwrites on a repeated scan for the same worktree', () => {
    db.setCorrectionScan('wt_3', '2026-09-06T00:00:00.000Z', 'commit-a')
    db.setCorrectionScan('wt_3', '2026-09-07T00:00:00.000Z', 'commit-b')

    expect(db.getCorrectionScan('wt_3')).toEqual({
      lastScannedAt: '2026-09-07T00:00:00.000Z',
      lastCommit: 'commit-b'
    })
  })
})
