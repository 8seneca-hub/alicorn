import type { OrchestrationDb } from './db'
import type { MessageRow } from './types'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import { applyEscalationToDispatch } from './coordinator-escalation-triage'
import { openDecisionGateFromMessage } from './coordinator-decision-gates'
import type { CoordinatorForemanJournal } from './coordinator-foreman-journal'

/** What the inbox needs from the run it is draining. Explicit so the handlers stay testable. */
export type CoordinatorInbox = {
  db: OrchestrationDb
  coordinatorHandle: string
  journal: CoordinatorForemanJournal
  onLog: (msg: string) => void
  completedTasks: string[]
  failedTasks: string[]
  escalations: MessageRow[]
}

/**
 * Drains the coordinator's inbox once.
 *
 * Split from `coordinator.ts` at its line cap, and cohesive on its own: everything here is a
 * reaction to a message a worker sent.
 */
export async function processCoordinatorMessages(inbox: CoordinatorInbox): Promise<void> {
  const messages = inbox.db.getUnreadMessages(inbox.coordinatorHandle)
  if (messages.length === 0) {
    return
  }

  for (const msg of messages) {
    switch (msg.type) {
      case 'worker_done':
      case 'heartbeat':
        await handleLifecycleMessage(inbox, msg)
        break
      case 'escalation':
        await handleEscalation(inbox, msg)
        break
      case 'decision_gate':
        openDecisionGateFromMessage(inbox.db, msg, inbox.onLog)
        break
      case 'status':
        inbox.onLog(`Status from ${msg.from_handle}: ${msg.subject}`)
        break
      case 'dispatch':
      case 'handoff':
      case 'merge_ready':
      case 'question':
        break
    }
  }

  inbox.db.markAsRead(messages.map((m) => m.id))
}

async function handleLifecycleMessage(inbox: CoordinatorInbox, msg: MessageRow): Promise<void> {
  const result = reconcileLifecycleMessage(inbox.db, msg, inbox.onLog)
  if (result.action === 'completed') {
    if (!inbox.completedTasks.includes(result.taskId)) {
      inbox.completedTasks.push(result.taskId)
    }
    await inbox.journal.onTaskSettled(result.taskId, 'completed')
    return
  }
  if (result.action === 'failed') {
    if (!inbox.failedTasks.includes(result.taskId)) {
      inbox.failedTasks.push(result.taskId)
    }
    await inbox.journal.onTaskSettled(result.taskId, 'failed')
  }
}

async function handleEscalation(inbox: CoordinatorInbox, msg: MessageRow): Promise<void> {
  inbox.onLog(`Escalation from ${msg.from_handle}: ${msg.subject}`)
  inbox.escalations.push(msg)
  await inbox.journal.onEscalation(msg.subject, msg.from_handle)

  const circuitBrokenTaskId = applyEscalationToDispatch(inbox.db, msg, inbox.onLog)
  if (circuitBrokenTaskId) {
    inbox.failedTasks.push(circuitBrokenTaskId)
  }
}
