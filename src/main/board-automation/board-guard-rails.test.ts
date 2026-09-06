import { describe, expect, it } from 'vitest'
import type { BoardTransitionRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import {
  BOARD_DISPATCH_CEILING,
  BOARD_LOOP_MAX_REVISITS,
  evaluateBoardGuard
} from './board-guard-rails'

const NOW = Date.parse('2026-09-06T12:00:00.000Z')

function row(over: Partial<BoardTransitionRow> = {}): BoardTransitionRow {
  return {
    id: 'bt_1',
    repoId: 'repo-1',
    worktreeId: 'wt-1',
    taskId: 'task-1',
    dispatchId: 'ctx-1',
    fromStatusId: 'in-progress',
    toStatusId: 'in-review',
    ruleId: 'rule-1',
    outcome: 'dispatched',
    createdAt: new Date(NOW - 60_000).toISOString(),
    ...over
  }
}

function guard(over: Partial<Parameters<typeof evaluateBoardGuard>[0]> = {}) {
  return evaluateBoardGuard({
    now: NOW,
    transitions: [],
    toStatusId: 'in-review',
    killed: false,
    ...over
  })
}

describe('evaluateBoardGuard', () => {
  it('allows a first dispatch', () => {
    expect(guard()).toEqual({ allow: true })
  })

  // Why first: a human switching automation off must not be second-guessed by a budget that
  // happens to have room.
  it('refuses when killed, whatever the history says', () => {
    const verdict = guard({ killed: true, transitions: [] })
    expect(verdict).toMatchObject({ allow: false, reason: 'killed' })
  })

  it('refuses at the ceiling and names the count', () => {
    const transitions = Array.from({ length: BOARD_DISPATCH_CEILING.max }, (_, i) =>
      row({
        id: `bt_${i}`,
        toStatusId: `col-${i}`,
        createdAt: new Date(NOW - i * 60_000).toISOString()
      })
    )
    const verdict = guard({ transitions, toStatusId: 'fresh-column' })

    expect(verdict).toMatchObject({ allow: false, reason: 'ceiling' })
    expect(verdict).toHaveProperty(
      'detail',
      expect.stringContaining(String(BOARD_DISPATCH_CEILING.max))
    )
  })

  it('ignores dispatches older than the ceiling window', () => {
    const old = new Date(NOW - BOARD_DISPATCH_CEILING.windowMs - 1_000).toISOString()
    const transitions = Array.from({ length: BOARD_DISPATCH_CEILING.max }, (_, i) =>
      row({ id: `bt_${i}`, toStatusId: `col-${i}`, createdAt: old })
    )
    expect(guard({ transitions, toStatusId: 'fresh-column' })).toEqual({ allow: true })
  })

  // Why: refusals are recorded as rows too, and they cost nothing. Counting them against the
  // ceiling would let a refused board lock itself out.
  it('counts only dispatches, not refusals', () => {
    const transitions = [
      row({ id: 'a', outcome: 'refused_ceiling', toStatusId: 'c1' }),
      row({ id: 'b', outcome: 'refused_loop', toStatusId: 'c2' }),
      row({ id: 'c', outcome: 'refused_killed', toStatusId: 'c3' })
    ]
    expect(guard({ transitions, toStatusId: 'fresh-column' })).toEqual({ allow: true })
  })

  // Why: this is the return edge the product treats as first-class — review sends findings back to
  // build, and build hands back to review. One correction cycle must not read as a loop.
  it('allows one correction cycle back into the same column', () => {
    const transitions = [row({ id: 'first-review', toStatusId: 'in-review' })]
    expect(guard({ transitions, toStatusId: 'in-review' })).toEqual({ allow: true })
  })

  it('refuses a second revisit of the same column', () => {
    const transitions = [
      row({ id: 'r1', toStatusId: 'in-review', createdAt: new Date(NOW - 120_000).toISOString() }),
      row({ id: 'r2', toStatusId: 'in-review', createdAt: new Date(NOW - 60_000).toISOString() })
    ]
    const verdict = guard({ transitions, toStatusId: 'in-review' })

    expect(verdict).toMatchObject({ allow: false, reason: 'loop' })
    expect(BOARD_LOOP_MAX_REVISITS).toBe(1)
  })

  it('counts revisits per column, not across the board', () => {
    const transitions = [
      row({ id: 'a', toStatusId: 'in-progress' }),
      row({ id: 'b', toStatusId: 'in-review' })
    ]
    expect(guard({ transitions, toStatusId: 'in-review' })).toEqual({ allow: true })
  })

  // Why ceiling first: when both would refuse, the reason reported has to be the one that actually
  // bounds spend, or the kill-switch UI explains the wrong thing.
  it('reports the ceiling when both the ceiling and the loop would refuse', () => {
    const transitions = Array.from({ length: BOARD_DISPATCH_CEILING.max }, (_, i) =>
      row({
        id: `bt_${i}`,
        toStatusId: 'in-review',
        createdAt: new Date(NOW - i * 60_000).toISOString()
      })
    )
    expect(guard({ transitions, toStatusId: 'in-review' })).toMatchObject({
      allow: false,
      reason: 'ceiling'
    })
  })

  // Why: a row with a broken timestamp must not read as "long ago" and quietly widen the window.
  it('treats an unparseable timestamp as inside the window', () => {
    const transitions = Array.from({ length: BOARD_DISPATCH_CEILING.max }, (_, i) =>
      row({ id: `bt_${i}`, toStatusId: `col-${i}`, createdAt: 'not a date' })
    )
    expect(guard({ transitions, toStatusId: 'fresh-column' })).toMatchObject({
      allow: false,
      reason: 'ceiling'
    })
  })
})
