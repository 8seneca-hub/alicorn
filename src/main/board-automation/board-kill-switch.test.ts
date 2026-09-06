import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import {
  BOARD_KILL_SCOPE_GLOBAL,
  boardKillScope,
  getBoardAutomationStatus,
  isBoardAutomationKilled,
  setBoardAutomationKilled
} from './board-kill-switch'

describe('board kill switch', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const status = () => getBoardAutomationStatus(db, 'repo-1', { lastRefusalSinceMs: 0 })

  it('runs by default', () => {
    expect(isBoardAutomationKilled(db, 'repo-1')).toBe(false)
    expect(status()).toMatchObject({ killed: false, lastRefusal: null })
  })

  it('stops one board without touching another', () => {
    setBoardAutomationKilled(db, boardKillScope('repo-1'), 'nghia')

    expect(isBoardAutomationKilled(db, 'repo-1')).toBe(true)
    expect(isBoardAutomationKilled(db, 'repo-2')).toBe(false)
  })

  // Why either scope: a global stop must not be defeated by a board that was never individually
  // disabled — that is the whole point of having a global switch.
  it('stops every board from the global scope', () => {
    setBoardAutomationKilled(db, BOARD_KILL_SCOPE_GLOBAL, 'nghia')

    expect(isBoardAutomationKilled(db, 'repo-1')).toBe(true)
    expect(isBoardAutomationKilled(db, 'repo-2')).toBe(true)
  })

  it('keeps a board stopped while the global scope is resumed', () => {
    setBoardAutomationKilled(db, BOARD_KILL_SCOPE_GLOBAL, 'nghia')
    setBoardAutomationKilled(db, boardKillScope('repo-1'), 'nghia')
    setBoardAutomationKilled(db, BOARD_KILL_SCOPE_GLOBAL, null)

    expect(isBoardAutomationKilled(db, 'repo-1')).toBe(true)
    expect(isBoardAutomationKilled(db, 'repo-2')).toBe(false)
  })

  // Why: resuming one board cannot lift a global stop, or "stop everything" would be a lie.
  it('keeps every board stopped while a global stop stands', () => {
    setBoardAutomationKilled(db, BOARD_KILL_SCOPE_GLOBAL, 'nghia')
    setBoardAutomationKilled(db, boardKillScope('repo-1'), null)

    expect(isBoardAutomationKilled(db, 'repo-1')).toBe(true)
  })

  it('reports who stopped it and when, per scope', () => {
    setBoardAutomationKilled(db, boardKillScope('repo-1'), 'nghia')

    const state = status()
    expect(state.boardDisabledBy).toBe('nghia')
    expect(state.boardDisabledAt).not.toBeNull()
    expect(state.globalDisabledAt).toBeNull()
  })

  describe('last refusal', () => {
    function record(
      outcome: 'dispatched' | 'refused_ceiling' | 'refused_loop',
      toStatusId: string
    ) {
      db.recordBoardTransition({
        repoId: 'repo-1',
        worktreeId: 'wt-1',
        toStatusId,
        ruleId: 'rule-1',
        outcome
      })
    }

    // Why this matters: "running, but nothing happens" is the confusing state, and the last refusal
    // is the only thing that explains it.
    // Why this needs sub-second precision: two board moves in the same second are ordinary, and at
    // second resolution the tie broke on a random generated id — "most recent" was a coin flip.
    it('reports the most recent refusal even within the same second', () => {
      record('refused_ceiling', 'in-review')
      record('refused_loop', 'in-progress')

      expect(status().lastRefusal).toMatchObject({
        outcome: 'refused_loop',
        toStatusId: 'in-progress'
      })
    })

    it('ignores successful dispatches', () => {
      record('dispatched', 'in-review')
      expect(status().lastRefusal).toBeNull()
    })

    it('scopes refusals to the repo', () => {
      db.recordBoardTransition({
        repoId: 'repo-2',
        worktreeId: 'wt-9',
        toStatusId: 'in-review',
        ruleId: 'rule-9',
        outcome: 'refused_loop'
      })

      expect(status().lastRefusal).toBeNull()
    })

    // Why across workspaces: the header asks "why is nothing happening on this board?", which is a
    // repo question — a refusal on any of its workspaces answers it.
    it('reports a refusal from any workspace on the board', () => {
      db.recordBoardTransition({
        repoId: 'repo-1',
        worktreeId: 'wt-other',
        toStatusId: 'in-review',
        ruleId: 'rule-1',
        outcome: 'refused_ceiling'
      })

      expect(status().lastRefusal).toMatchObject({ outcome: 'refused_ceiling' })
    })
  })
})
