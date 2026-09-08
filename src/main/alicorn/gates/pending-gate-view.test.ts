import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { listPendingGateViews } from './pending-gate-view'

describe('listPendingGateViews', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function gateWithLevel(level: number | null): ReturnType<typeof listPendingGateViews>[number] {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'ship it' })
    const gate = db.createGate({ taskId: task.id, question: 'Merge?', options: ['yes', 'no'] })
    if (level !== null) {
      db.setGateRecommendation(gate.id, { decision: 'auto', reason: 'auto', level })
    }
    return listPendingGateViews(db)[0]
  }

  it('shows the recommendation once the member has reached level 1', () => {
    const view = gateWithLevel(1)
    expect(view.recommendation).toEqual({ decision: 'auto', reason: 'auto' })
    expect(view.policyEvaluated).toBe(true)
    expect(view.options).toEqual(['yes', 'no'])
  })

  it('withholds it at level 0 so the answer is given blind', () => {
    const view = gateWithLevel(0)
    expect(view.recommendation).toBeNull()
    // Still recorded — the panel can say so without saying what it was.
    expect(view.policyEvaluated).toBe(true)
    expect(view.autonomyLevel).toBe(0)
  })

  it('reports nothing evaluated for a gate opened without asking the policy', () => {
    const view = gateWithLevel(null)
    expect(view.recommendation).toBeNull()
    expect(view.policyEvaluated).toBe(false)
    expect(view.autonomyLevel).toBeNull()
  })

  it('lists only gates still waiting', () => {
    const view = gateWithLevel(2)
    db.resolveGate(view.id, 'yes')
    expect(listPendingGateViews(db)).toEqual([])
  })
})
