/**
 * The questions an agent is waiting on, answerable from the inbox.
 *
 * The same card the session draws, in the other place a developer looks. Answering here sends the
 * mutation the session's own card would have sent, so the two cannot disagree about what was
 * decided — there is one journal item, and it resolves once.
 *
 * An option is committed by **id**, never by label. A label is copy, it is translated, and two
 * options can read the same; the id is what the agent asked about.
 */
import React from 'react'
import { MessageCircleQuestion, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import { answerPendingQuestion, type PendingQuestion } from './use-pending-questions'

export function AlicornInboxQuestions({
  questions,
  onAnswered,
  onOpenTask
}: {
  questions: readonly PendingQuestion[]
  onAnswered: () => void
  onOpenTask: (taskId: string) => void
}): React.JSX.Element | null {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)

  if (questions.length === 0) {
    return null
  }

  const answer = async (question: PendingQuestion, optionId: string): Promise<void> => {
    setBusy(question.itemId)
    setFailure(null)
    try {
      await answerPendingQuestion(question, optionId)
      onAnswered()
    } catch (cause) {
      setFailure(describeFailure(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[13px] font-semibold">
        {questions.length === 1
          ? translate('auto.components.alicorn.inbox.oneQuestion', 'One agent is waiting on you')
          : translate(
              'auto.components.alicorn.inbox.questions',
              '{{count}} agents are waiting on you',
              { count: questions.length }
            )}
      </h2>
      <ul className="space-y-2">
        {questions.map((question) => (
          <li
            key={`${question.sessionId}:${question.itemId}`}
            className="rounded-xl border border-status-attention/40 bg-status-attention/5 px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {question.kind === 'approval' ? (
                <ShieldQuestion className="size-3.5 shrink-0 text-status-attention" />
              ) : (
                <MessageCircleQuestion className="size-3.5 shrink-0 text-status-attention" />
              )}
              <button
                type="button"
                onClick={() => onOpenTask(question.taskId)}
                className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {question.ref}
              </button>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                {question.title}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px]">{question.question}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void answer(question, option.id)}
                >
                  {option.label}
                </Button>
              ))}
              {question.options.length === 0 ? (
                <Button size="sm" variant="outline" onClick={() => onOpenTask(question.taskId)}>
                  {translate(
                    'auto.components.alicorn.inbox.openToAnswer',
                    'Open the task to answer'
                  )}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {failure ? <p className="mt-2 text-[11px] text-destructive">{failure}</p> : null}
    </section>
  )
}
