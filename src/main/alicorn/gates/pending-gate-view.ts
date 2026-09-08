import { isAdvisory, type PendingGateView } from '../../../shared/alicorn/gate-review'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { DecisionGateRow } from '../../runtime/orchestration/types'

function parseOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : []
  } catch {
    return []
  }
}

/**
 * Projects a gate row for the panel, withholding the recommendation below level 1.
 *
 * Withholding here rather than in the renderer is the point: at level 0 the human answers with
 * nothing on screen, so the agreement recorded then measures the policy. Once level 1 is entered
 * the same question is answered with the recommendation visible, and the two populations can be
 * compared — which is the only way to tell whether the pre-fill is steering the answer.
 */
export function toPendingGateView(db: OrchestrationDb, gate: DecisionGateRow): PendingGateView {
  const task = db.getTask(gate.task_id)
  const evaluated = gate.recommended_decision !== null
  return {
    id: gate.id,
    taskId: gate.task_id,
    taskTitle: task?.task_title ?? task?.display_name ?? null,
    question: gate.question,
    options: parseOptions(gate.options),
    createdAt: gate.created_at,
    recommendation:
      evaluated && isAdvisory(gate.recommended_level)
        ? { decision: gate.recommended_decision!, reason: gate.recommended_reason ?? 'auto' }
        : null,
    policyEvaluated: evaluated,
    autonomyLevel: gate.recommended_level
  }
}

export function listPendingGateViews(db: OrchestrationDb): PendingGateView[] {
  return db.listGates({ status: 'pending' }).map((gate) => toPendingGateView(db, gate))
}
