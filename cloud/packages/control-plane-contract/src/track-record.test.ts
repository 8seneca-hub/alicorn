import { describe, expect, it } from 'vitest'
import {
  computeAutonomyLevel,
  summarizeTrackRecord,
  type TrackRecordOutcome,
  type TrackRecordVerdict
} from './track-record.js'

const KEY = { memberId: 'm1', stageKey: 'build', projectId: 'p1' }

function outcomes(
  count: number,
  verdict: TrackRecordVerdict = 'accepted',
  succeeded = true
): TrackRecordOutcome[] {
  return Array.from({ length: count }, (_, i) => ({
    succeeded,
    humanVerdict: verdict,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, count - i)).toISOString()
  }))
}

describe('summarizeTrackRecord', () => {
  it('reports an empty record as zero runs, not as a pass', () => {
    const record = summarizeTrackRecord(KEY, [])
    expect(record).toMatchObject({ runs: 0, acceptRate: 0, recentRegression: false, level: 0 })
  })

  it('counts a human amendment against the accept rate even when the agent reported success', () => {
    const record = summarizeTrackRecord(KEY, [
      ...outcomes(1, 'amended'),
      ...outcomes(3, 'accepted')
    ])
    expect(record.accepted).toBe(3)
    expect(record.amended).toBe(1)
    expect(record.acceptRate).toBe(0.75)
  })

  it('reads a single rejection inside the last ten as a regression', () => {
    expect(summarizeTrackRecord(KEY, [...outcomes(1, 'rejected'), ...outcomes(9)]).recentRegression)
      .toBe(true)
  })

  it('needs two amendments, not one, inside the last ten', () => {
    expect(summarizeTrackRecord(KEY, [...outcomes(1, 'amended'), ...outcomes(9)]).recentRegression)
      .toBe(false)
    expect(summarizeTrackRecord(KEY, [...outcomes(2, 'amended'), ...outcomes(8)]).recentRegression)
      .toBe(true)
  })

  it('does not see a rejection that has aged out of the regression window', () => {
    const window = [...outcomes(10), ...outcomes(1, 'rejected')]
    expect(summarizeTrackRecord(KEY, window).recentRegression).toBe(false)
    expect(summarizeTrackRecord(KEY, window).rejected).toBe(1)
  })

  it('takes the newest amendment as lastAmendedAt', () => {
    const record = summarizeTrackRecord(KEY, [
      { succeeded: true, humanVerdict: 'amended', createdAt: '2026-02-01T00:00:00.000Z' },
      { succeeded: true, humanVerdict: 'amended', createdAt: '2026-01-01T00:00:00.000Z' }
    ])
    expect(record.lastAmendedAt).toBe('2026-02-01T00:00:00.000Z')
  })
})

describe('computeAutonomyLevel', () => {
  const clean = { recentRegression: false, amendmentsObserved: true, amendedInCleanWindow: false }

  it('walks the level table', () => {
    expect(computeAutonomyLevel({ runs: 9, acceptRate: 1, ...clean })).toBe(0)
    expect(computeAutonomyLevel({ runs: 10, acceptRate: 1, ...clean })).toBe(1)
    expect(computeAutonomyLevel({ runs: 20, acceptRate: 0.9, ...clean })).toBe(2)
    expect(computeAutonomyLevel({ runs: 50, acceptRate: 0.95, ...clean })).toBe(3)
  })

  it('holds a stage back when the accept rate misses the band', () => {
    expect(computeAutonomyLevel({ runs: 30, acceptRate: 0.89, ...clean })).toBe(1)
  })

  it('drops one level on a regression and no further', () => {
    expect(
      computeAutonomyLevel({ runs: 50, acceptRate: 0.95, ...clean, recentRegression: true })
    ).toBe(2)
    expect(
      computeAutonomyLevel({ runs: 0, acceptRate: 0, ...clean, recentRegression: true })
    ).toBe(0)
  })

  it('keeps level 3 out of reach while an amendment sits in the clean window', () => {
    expect(
      computeAutonomyLevel({ runs: 60, acceptRate: 0.96, ...clean, amendedInCleanWindow: true })
    ).toBe(2)
  })

  it('caps at advisory until a human verdict has ever been observed', () => {
    expect(
      computeAutonomyLevel({ runs: 100, acceptRate: 1, ...clean, amendmentsObserved: false })
    ).toBe(1)
  })
})
