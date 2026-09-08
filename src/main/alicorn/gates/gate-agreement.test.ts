import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { enqueueGateAgreement, gateAgreementPatch, isGateVerdict } from './gate-agreement'
import type { DecisionGateRow } from '../../runtime/orchestration/types'

function gateRow(overrides: Partial<DecisionGateRow> = {}): DecisionGateRow {
  return {
    id: 'gate_1',
    run_id: 'run_1',
    task_id: 'task_1',
    question: 'Proceed?',
    options: '[]',
    status: 'resolved',
    resolution: 'yes',
    created_at: '2026-09-08 00:00:00',
    resolved_at: '2026-09-08 00:01:00',
    recommended_decision: 'auto',
    recommended_reason: 'auto',
    recommended_level: 1,
    ...overrides
  }
}

describe('gateAgreementPatch', () => {
  it('agrees when the human reached the same call as the policy', () => {
    const patch = gateAgreementPatch(gateRow(), { decision: 'auto', recommendationShown: true })
    expect(patch).toEqual({
      gateId: 'gate_1',
      policyRecommendation: 'auto',
      policyRecommendationReason: 'auto',
      humanGateDecision: 'auto',
      recommendationShown: true
    })
  })

  it('carries the disagreement rather than dropping it', () => {
    const patch = gateAgreementPatch(gateRow(), { decision: 'gate', recommendationShown: false })
    expect(patch).toMatchObject({ policyRecommendation: 'auto', humanGateDecision: 'gate' })
  })

  it('records nothing when the policy was never asked', () => {
    expect(
      gateAgreementPatch(gateRow({ recommended_decision: null, recommended_reason: null }), {
        decision: 'auto',
        recommendationShown: false
      })
    ).toBeNull()
  })

  it('rejects anything that is not one of the two gate verdicts', () => {
    expect(isGateVerdict('auto')).toBe(true)
    expect(isGateVerdict('gate')).toBe(true)
    expect(isGateVerdict('accepted')).toBe(false)
    expect(isGateVerdict(undefined)).toBe(false)
  })
})

describe('enqueueGateAgreement', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function taskWithDispatch(): { taskId: string; dispatchId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: JSON.stringify({ phase: 'build', body: 'done', filesModified: [] })
    })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('enqueues one outbox row naming the dispatch the gate was opened about', () => {
    const { taskId, dispatchId } = taskWithDispatch()
    const gate = db.createGate({ taskId, question: 'Proceed?' })
    db.setGateRecommendation(gate.id, { decision: 'auto', reason: 'auto', level: 1 })
    const resolved = db.resolveGate(gate.id, 'yes')!

    expect(enqueueGateAgreement(db, resolved, { decision: 'gate', recommendationShown: true })).toBe(
      1
    )
    const row = db
      .listDueLedgerOutbox(25)
      .find((candidate) => candidate.kind === 'gate_agreement_patch')!
    expect(row.dedupe_key).toBe(`gate_agreement:${gate.id}`)
    expect(JSON.parse(row.payload)).toEqual({
      gateId: gate.id,
      dispatchId,
      policyRecommendation: 'auto',
      policyRecommendationReason: 'auto',
      humanGateDecision: 'gate',
      recommendationShown: true
    })
  })

  it('is exactly-once per gate', () => {
    const { taskId } = taskWithDispatch()
    const gate = db.createGate({ taskId, question: 'Proceed?' })
    db.setGateRecommendation(gate.id, { decision: 'auto', reason: 'auto', level: 1 })
    const resolved = db.resolveGate(gate.id, 'yes')!

    expect(enqueueGateAgreement(db, resolved, { decision: 'auto', recommendationShown: false })).toBe(1)
    expect(enqueueGateAgreement(db, resolved, { decision: 'gate', recommendationShown: false })).toBe(0)
    expect(
      db.listDueLedgerOutbox(25).filter((row) => row.kind === 'gate_agreement_patch')
    ).toHaveLength(1)
  })

  it('enqueues nothing for a gate the policy never evaluated', () => {
    const { taskId } = taskWithDispatch()
    const gate = db.createGate({ taskId, question: 'Proceed?' })
    const resolved = db.resolveGate(gate.id, 'yes')!

    expect(enqueueGateAgreement(db, resolved, { decision: 'auto', recommendationShown: false })).toBe(0)
    expect(db.listDueLedgerOutbox(25).some((row) => row.kind === 'gate_agreement_patch')).toBe(false)
  })
})
