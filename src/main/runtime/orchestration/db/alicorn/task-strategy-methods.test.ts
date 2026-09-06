import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('task execution strategy methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('defaults to single/default when no row exists', () => {
    expect(db.getTaskExecutionStrategy('task-1')).toEqual({
      strategy: 'single',
      source: 'default',
      escalationOfferedAt: null,
      escalationAcceptedAt: null
    })
  })

  it('sets and reads back a user-chosen strategy', () => {
    db.setTaskExecutionStrategy('task-1', 'orchestrated', 'user')

    const strategy = db.getTaskExecutionStrategy('task-1')
    expect(strategy.strategy).toBe('orchestrated')
    expect(strategy.source).toBe('user')
    expect(strategy.escalationAcceptedAt).toBeNull()
  })

  it('stamps escalation_accepted_at when the source is escalation', () => {
    db.setTaskExecutionStrategy('task-1', 'orchestrated', 'escalation')

    const strategy = db.getTaskExecutionStrategy('task-1')
    expect(strategy.strategy).toBe('orchestrated')
    expect(strategy.source).toBe('escalation')
    expect(strategy.escalationAcceptedAt).not.toBeNull()
  })

  it('offers escalation once and refuses a second offer', () => {
    expect(db.markEscalationOffered('task-1')).toBe(true)
    expect(db.markEscalationOffered('task-1')).toBe(false)

    const strategy = db.getTaskExecutionStrategy('task-1')
    expect(strategy.strategy).toBe('single')
    expect(strategy.escalationOfferedAt).not.toBeNull()
  })
})
