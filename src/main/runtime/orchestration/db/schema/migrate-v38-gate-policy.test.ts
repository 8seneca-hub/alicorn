import { describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

describe('v38 gate policy migration', () => {
  it('adds the recommendation columns and the verification table on a fresh database', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      expect(db.hasColumn('decision_gates', 'recommended_decision')).toBe(true)
      expect(db.hasColumn('decision_gates', 'recommended_reason')).toBe(true)
      expect(db.hasColumn('alicorn_dispatch_verifications', 'status')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('records a recommendation without resolving the gate', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const task = db.createTask({ spec: 'ship it' })
      const gate = db.createGate({ taskId: task.id, question: 'Proceed?' })
      const recorded = db.setGateRecommendation(gate.id, {
        decision: 'auto',
        reason: 'never_gate',
        level: 2
      })
      expect(recorded).toMatchObject({
        status: 'pending',
        resolution: null,
        recommended_decision: 'auto',
        recommended_reason: 'never_gate',
        recommended_level: 2
      })
      expect(db.getTask(task.id)?.status).toBe('blocked')
    } finally {
      db.close()
    }
  })
})
