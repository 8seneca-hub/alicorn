import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('board transition methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const transition = (over: Record<string, unknown> = {}) => ({
    repoId: 'repo-1',
    worktreeId: 'wt-1',
    toStatusId: 'in-review',
    ruleId: 'rule-1',
    outcome: 'dispatched' as const,
    ...over
  })

  it('records a dispatched transition and reads it back', () => {
    const id = db.recordBoardTransition(
      transition({ fromStatusId: 'in-progress', taskId: 'task-1', dispatchId: 'ctx-1' })
    )

    const rows = db.listBoardTransitions('wt-1', '1970-01-01T00:00:00.000Z')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id,
      repoId: 'repo-1',
      worktreeId: 'wt-1',
      fromStatusId: 'in-progress',
      toStatusId: 'in-review',
      ruleId: 'rule-1',
      taskId: 'task-1',
      dispatchId: 'ctx-1',
      outcome: 'dispatched'
    })
  })

  // Why: a refusal is history too. A board that silently stopped dispatching has to be explainable
  // from the table rather than from logs.
  it('records every refusal outcome', () => {
    for (const outcome of ['refused_ceiling', 'refused_loop', 'refused_killed'] as const) {
      db.recordBoardTransition(transition({ outcome }))
    }
    const rows = db.listBoardTransitions('wt-1', '1970-01-01T00:00:00.000Z')
    expect(rows.map((row) => row.outcome).sort()).toEqual([
      'refused_ceiling',
      'refused_killed',
      'refused_loop'
    ])
  })

  it('rejects an outcome the guards do not define', () => {
    expect(() => db.recordBoardTransition(transition({ outcome: 'exploded' as never }))).toThrow()
  })

  // Why: the ceiling counts transitions inside a window, so the lower bound has to actually filter.
  it('lists only transitions at or after the window start', () => {
    db.db
      .prepare(
        `INSERT INTO alicorn_board_transitions (id, repo_id, worktree_id, to_status_id, rule_id, outcome, created_at)
         VALUES (?, 'repo-1', 'wt-1', 'in-review', 'rule-1', 'dispatched', ?)`
      )
      .run('old', '2026-09-01T00:00:00.000Z')
    db.db
      .prepare(
        `INSERT INTO alicorn_board_transitions (id, repo_id, worktree_id, to_status_id, rule_id, outcome, created_at)
         VALUES (?, 'repo-1', 'wt-1', 'in-review', 'rule-1', 'dispatched', ?)`
      )
      .run('recent', '2026-09-06T12:00:00.000Z')

    const rows = db.listBoardTransitions('wt-1', '2026-09-06T00:00:00.000Z')
    expect(rows.map((row) => row.id)).toEqual(['recent'])
  })

  it('scopes the listing to one worktree', () => {
    db.recordBoardTransition(transition())
    db.recordBoardTransition(transition({ worktreeId: 'wt-2' }))

    expect(db.listBoardTransitions('wt-1', '1970-01-01T00:00:00.000Z')).toHaveLength(1)
  })

  it('orders newest last so a loop walk reads forwards in time', () => {
    for (const [id, at] of [
      ['b', '2026-09-06T02:00:00.000Z'],
      ['a', '2026-09-06T01:00:00.000Z']
    ]) {
      db.db
        .prepare(
          `INSERT INTO alicorn_board_transitions (id, repo_id, worktree_id, to_status_id, rule_id, outcome, created_at)
           VALUES (?, 'repo-1', 'wt-1', 'in-review', 'rule-1', 'dispatched', ?)`
        )
        .run(id, at)
    }
    expect(db.listBoardTransitions('wt-1', '1970-01-01T00:00:00.000Z').map((r) => r.id)).toEqual([
      'a',
      'b'
    ])
  })

  describe('automation state', () => {
    // Why: absent row means enabled. Automation must not require a row to run, or a fresh install
    // would look disabled.
    it('reads as enabled when no row exists', () => {
      expect(db.getBoardAutomationState('global')).toEqual({
        scope: 'global',
        disabledAt: null,
        disabledBy: null
      })
    })

    it('disables a scope and records who did it', () => {
      db.setBoardAutomationDisabled('board:repo-1', 'nghia')

      const state = db.getBoardAutomationState('board:repo-1')
      expect(state.disabledBy).toBe('nghia')
      expect(state.disabledAt).not.toBeNull()
    })

    it('re-enables by clearing the row', () => {
      db.setBoardAutomationDisabled('global', 'nghia')
      db.setBoardAutomationDisabled('global', null)

      expect(db.getBoardAutomationState('global')).toEqual({
        scope: 'global',
        disabledAt: null,
        disabledBy: null
      })
    })

    it('keeps scopes independent', () => {
      db.setBoardAutomationDisabled('board:repo-1', 'nghia')

      expect(db.getBoardAutomationState('global').disabledAt).toBeNull()
      expect(db.getBoardAutomationState('board:repo-2').disabledAt).toBeNull()
    })

    it('is idempotent on a repeated disable', () => {
      db.setBoardAutomationDisabled('global', 'nghia')
      const first = db.getBoardAutomationState('global').disabledAt
      db.setBoardAutomationDisabled('global', 'huy')

      expect(db.getBoardAutomationState('global').disabledBy).toBe('huy')
      expect(db.getBoardAutomationState('global').disabledAt).toBe(first)
    })
  })
})
