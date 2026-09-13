/**
 * The queue, as a place rather than a sidebar panel.
 *
 * Two things wait on a developer and they are not the same thing. A **gate** is authored on a stage
 * and lives in the control plane. A **question** is an agent stopping mid-run to ask something it
 * could not decide, and lives in that session's journal. Both mean "something needs me", so both
 * are here — an inbox that showed one of them would be lying by omission.
 *
 * Gates reuse GatePanel outright: resolving one is the same act here as in the sidebar, and a second
 * implementation would be a second thing to keep honest. Questions are answered with the same
 * mutation the session's own card sends, so answering in either place resolves the other's copy.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'
import { GatePanel } from '../../right-sidebar/gate-panel/GatePanel'
import { AlicornEmptyState, AlicornScreenHeader } from './AlicornScreenChrome'
import { AlicornInboxQuestions } from './AlicornInboxQuestions'
import { usePendingQuestions } from './use-pending-questions'
import type { Task } from '../../../../../shared/alicorn/tasks'

/** A stable empty list: a fresh `[]` each render would re-run the question read every time. */
const NO_TASKS: readonly Task[] = []

export function AlicornInboxScreen({
  gates,
  projectId,
  projectName,
  tasks = NO_TASKS,
  projectKey = '',
  onOpenTask
}: {
  gates: PendingGateView[] | null
  onResolved: () => void
  /** Null is the cross-project queue; a project id narrows the crumb, not the list. */
  projectId: string | null
  projectName?: string
  /** The project's tasks, whose sessions are where a question is waiting. */
  tasks?: readonly Task[]
  projectKey?: string
  onOpenTask?: (taskId: string) => void
}): React.JSX.Element {
  const { questions, reload } = usePendingQuestions(tasks, projectKey)
  const waiting = (gates?.length ?? 0) + questions.length
  return (
    <>
      <AlicornScreenHeader
        crumbs={projectId ? ['Alicorn', projectName ?? projectId] : ['Alicorn']}
        title={translate('auto.components.alicorn.shell.inbox', 'Inbox')}
      />
      {questions.length > 0 ? (
        <div className="px-9 pt-4">
          <AlicornInboxQuestions
            questions={questions}
            onAnswered={reload}
            onOpenTask={(taskId) => onOpenTask?.(taskId)}
          />
        </div>
      ) : null}
      {gates !== null && waiting === 0 ? (
        <AlicornEmptyState
          title={translate('auto.components.alicorn.inbox.clearTitle', 'Nothing is waiting on you')}
          detail={translate(
            'auto.components.alicorn.inbox.clearDetail',
            'A step that needs a decision appears here. Every one you resolve stays on the ledger — the point is to need fewer of them, not to hide them.'
          )}
        />
      ) : (gates?.length ?? 0) > 0 ? (
        <div className="min-h-0 flex-1">
          <GatePanel />
        </div>
      ) : null}
    </>
  )
}
