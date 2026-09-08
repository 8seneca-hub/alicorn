import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_KEY,
  FEATURE_DELIVERY_STAGE_KEYS,
  isAuthoredStageKey,
  normalizeStageKey,
  resolveStageKey,
  STAGE_KEY_MAX_LENGTH
} from './stage-keys'

describe('normalizeStageKey', () => {
  it.each([
    ['Build', 'build'],
    ['  Code Review  ', 'code-review'],
    ['in_progress', 'in-progress'],
    ['Build!!', 'build'],
    ['a--b', 'a-b'],
    ['-build-', 'build']
  ])('folds %j to %j', (raw, expected) => {
    expect(normalizeStageKey(raw)).toBe(expected)
  })

  it.each([null, undefined, '', '   ', '!!!', '---'])('reads %j as no key at all', (raw) => {
    expect(normalizeStageKey(raw)).toBeNull()
  })

  it('truncates to the narrower of the two wire bounds and never ends on a separator', () => {
    const key = normalizeStageKey(`${'a'.repeat(STAGE_KEY_MAX_LENGTH)}-tail`)
    expect(key).toBe('a'.repeat(STAGE_KEY_MAX_LENGTH))

    const trimmedAtSeparator = normalizeStageKey(`${'a'.repeat(STAGE_KEY_MAX_LENGTH - 1)}-tail`)
    expect(trimmedAtSeparator).toBe('a'.repeat(STAGE_KEY_MAX_LENGTH - 1))
  })
})

describe('the key every path emits is one both wire schemas accept', () => {
  const WIRE = /^[a-z0-9][a-z0-9_-]{0,62}$/
  it.each(['Build', '  Code Review!  ', `${'x'.repeat(200)} spill`, 'in-review', '', 'РУС'])(
    'emits a wire-valid key for %j',
    (phase) => {
      expect(resolveStageKey({ reportedPhase: phase }).stageKey).toMatch(WIRE)
    }
  )
})

describe('resolveStageKey', () => {
  it('takes the board column over the worker phase — the measured member never picks its stage', () => {
    expect(resolveStageKey({ boardColumnId: 'in-review', reportedPhase: 'build' })).toEqual({
      stageKey: 'review',
      source: 'board',
      authored: true
    })
  })

  it.each([
    ['todo', 'spec'],
    ['in-progress', 'build'],
    ['in-review', 'review'],
    ['completed', 'merge']
  ])('maps board column %j onto template stage %j', (columnId, stageKey) => {
    expect(resolveStageKey({ boardColumnId: columnId })).toMatchObject({
      stageKey,
      authored: true
    })
  })

  it('lands a board dispatch and a reported phase on the same key', () => {
    const board = resolveStageKey({ boardColumnId: 'in-progress' })
    const reported = resolveStageKey({ reportedPhase: 'Build' })
    expect(board.stageKey).toBe(reported.stageKey)
    expect(board.authored && reported.authored).toBe(true)
  })

  it.each(FEATURE_DELIVERY_STAGE_KEYS)('accepts template key %j from a reported phase', (key) => {
    expect(resolveStageKey({ reportedPhase: key })).toEqual({
      stageKey: key,
      source: 'template',
      authored: true
    })
  })

  it('keeps an unrecognised phase but does not call it authored', () => {
    expect(resolveStageKey({ reportedPhase: 'reveiw' })).toEqual({
      stageKey: 'reveiw',
      source: 'reported',
      authored: false
    })
  })

  it('keeps a board column nobody bound to a stage, unauthored', () => {
    expect(resolveStageKey({ boardColumnId: 'triage' })).toEqual({
      stageKey: 'triage',
      source: 'board',
      authored: false
    })
  })

  it('defaults to build when nothing named a stage', () => {
    expect(resolveStageKey({ boardColumnId: null, reportedPhase: '  ' })).toEqual({
      stageKey: DEFAULT_STAGE_KEY,
      source: 'default',
      authored: true
    })
  })

  it("honours a project's own authored set over the shipped template", () => {
    const authoredStageKeys = ['triage', 'ship']
    expect(resolveStageKey({ reportedPhase: 'triage', authoredStageKeys })).toMatchObject({
      stageKey: 'triage',
      authored: true
    })
    // `build` is a template key, but not this project's.
    expect(resolveStageKey({ reportedPhase: 'build', authoredStageKeys })).toMatchObject({
      stageKey: 'build',
      authored: false
    })
  })
})

describe('isAuthoredStageKey', () => {
  it('recognises every stage the shipped template authors', () => {
    for (const key of FEATURE_DELIVERY_STAGE_KEYS) {
      expect(isAuthoredStageKey(key)).toBe(true)
    }
  })

  it('rejects free text, including a near miss', () => {
    expect(isAuthoredStageKey('reveiw')).toBe(false)
    expect(isAuthoredStageKey('build ')).toBe(false)
  })
})
