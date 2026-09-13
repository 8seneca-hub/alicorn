/**
 * Every question an agent is waiting on, across the tasks of a project.
 *
 * A question a member asks mid-run is not a gate. Gates are authored on a stage and live in the
 * control plane; a question is the agent stopping to ask something it could not decide, and it
 * lives in that session's journal. Both mean the same thing to a developer — *something is waiting
 * on me* — so the inbox has to show both or it is not an inbox.
 *
 * Read through `agentSession.history`, which answers without mounting the session, and which hands
 * back the runtime fence the answer will need. That is what lets the inbox *answer* rather than
 * only link: the reply is the same mutation the session's own card sends, so whichever surface is
 * used, the other stops showing it as soon as it reads again.
 */
import React from 'react'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import {
  createStructuredAgentSessionOperationId,
  structuredAgentSessionPayloadFingerprint
} from '../../../../../shared/structured-agent-session-mutation'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'

const LOCAL = { kind: 'local' } as const

export type PendingQuestion = {
  sessionId: string
  fence: number
  itemId: string
  revision: number
  kind: 'approval' | 'question'
  taskId: string
  /** `ALC-2`, so the inbox names the ticket the way every other surface does. */
  ref: string
  title: string
  question: string
  options: { id: string; label: string }[]
}

type JournalItem = {
  itemId: string
  revision: number
  body: {
    kind: string
    resolution?: { state?: string }
    prompt?: string
    question?: string
    text?: string
    options?: { id?: string; optionId?: string; label?: string; text?: string }[]
  }
}

function readOptions(body: JournalItem['body']): { id: string; label: string }[] {
  return (body.options ?? [])
    .map((option) => ({
      // The id is what gets committed — never the label, which is copy and may be translated.
      id: String(option.id ?? option.optionId ?? ''),
      label: String(option.label ?? option.text ?? option.id ?? '')
    }))
    .filter((option) => option.id.length > 0)
}

export function usePendingQuestions(
  tasks: readonly Task[],
  projectKey: string
): { questions: PendingQuestion[]; reload: () => void } {
  const [questions, setQuestions] = React.useState<PendingQuestion[]>([])
  const [reloads, setReloads] = React.useState(0)
  // Ids rather than the array: the task list is rebuilt on every board read.
  const taskIds = tasks.map((task) => task.id).join(',')

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const found: PendingQuestion[] = []
      for (const task of tasks) {
        const bound = await window.api?.alicorn?.getSubjectSession?.(task.id)
        if (!bound?.ok || !bound.session) {
          continue
        }
        try {
          const page = await callStructuredAgentSession<{
            ok?: boolean
            page?: { items?: JournalItem[]; fence?: number }
          }>(LOCAL, 'agentSession.history', {
            sessionId: bound.session.sessionId,
            limit: 200,
            direction: 'backward'
          })
          const fence = page?.page?.fence
          if (typeof fence !== 'number') {
            continue
          }
          for (const item of page?.page?.items ?? []) {
            const kind = item.body?.kind
            if (kind !== 'approval' && kind !== 'question') {
              continue
            }
            if (item.body?.resolution?.state !== 'pending') {
              continue
            }
            found.push({
              sessionId: bound.session.sessionId,
              fence,
              itemId: item.itemId,
              revision: item.revision,
              kind,
              taskId: task.id,
              ref: taskRef(projectKey, task.number),
              title: task.title,
              question: String(item.body.prompt ?? item.body.question ?? item.body.text ?? ''),
              options: readOptions(item.body)
            })
          }
        } catch {
          // A session whose host cannot be reached simply contributes nothing; one unreadable
          // session must not empty the whole inbox.
        }
      }
      if (!cancelled) {
        setQuestions(found)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIds, projectKey, reloads])

  return { questions, reload: () => setReloads((count) => count + 1) }
}

/** The same mutation the session's own card sends, so either surface resolves the other's copy. */
export async function answerPendingQuestion(
  question: PendingQuestion,
  optionId: string
): Promise<void> {
  const method =
    question.kind === 'approval'
      ? 'agentSession.respondToApproval'
      : 'agentSession.respondToQuestion'
  await callStructuredAgentSession(LOCAL, method, {
    envelope: {
      sessionId: question.sessionId,
      clientOperationId: createStructuredAgentSessionOperationId(() => crypto.randomUUID()),
      expectedRuntimeFence: question.fence,
      payloadFingerprint: structuredAgentSessionPayloadFingerprint({
        method,
        sessionId: question.sessionId,
        fields: { itemId: question.itemId, expectedRevision: question.revision, optionId }
      })
    },
    itemId: question.itemId,
    expectedRevision: question.revision,
    optionId
  })
}
