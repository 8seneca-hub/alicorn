/**
 * The approval and question a structured session is waiting on.
 *
 * Lifted out of `NativeChatStructuredSession` so a second surface can host the same session
 * without a second copy of this mapping. The mapping is the part worth not duplicating: an option
 * is committed by its **id**, never its label, and a multi-question prompt encodes every answer
 * into one reply — getting either wrong answers the agent with a different choice than the one
 * that was clicked.
 */
import { encodeAgentSessionQuestionAnswers } from '../../../../shared/agent-session-question-answer'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'
import type { StructuredPromptItem } from './use-structured-agent-session'

function encodeQuestionAnswer(questionId: string, answer: string): string {
  return `${encodeURIComponent(questionId)}:${encodeURIComponent(answer)}`
}

export function StructuredAgentSessionPromptCards({
  prompt,
  onRespond,
  onCancelTurn
}: {
  /** Null while nothing is pending, which is most of a session. */
  prompt: StructuredPromptItem | null
  onRespond: (prompt: StructuredPromptItem, optionId: string) => void
  onCancelTurn: () => void
}): React.JSX.Element | null {
  if (!prompt) {
    return null
  }
  if (prompt.body.kind === 'approval') {
    const body = prompt.body
    return (
      <NativeChatApprovalCard
        approval={{
          title: body.title,
          ...(body.detail ? { detail: body.detail } : {}),
          options: body.options.map((option) => ({ label: option.label, send: option.id }))
        }}
        onChoose={(optionId) => onRespond(prompt, optionId)}
      />
    )
  }

  const body = prompt.body
  const questions = body.questions ?? [
    {
      id: body.freeTextQuestionId ?? 'q1',
      question: body.question,
      options: body.options,
      multiSelect: false,
      ...(body.freeTextQuestionId ? { freeTextQuestionId: body.freeTextQuestionId } : {})
    }
  ]

  return (
    <NativeChatQuestionCard
      key={`${prompt.itemId}:${prompt.revision}`}
      prompt={{
        questions: questions.map((question) => ({
          question: question.question,
          ...(question.header ? { header: question.header } : {}),
          multiSelect: question.multiSelect,
          options: question.options.map((option) => ({
            label: option.label,
            ...(option.description ? { description: option.description } : {})
          }))
        }))
      }}
      allowOther={questions.map((question) => Boolean(question.freeTextQuestionId))}
      onAnswer={(answers) => {
        if (body.questions) {
          const grouped = questions.map((question, questionIndex) => {
            const answer = answers[questionIndex]
            const other = answer?.other?.trim()
            const optionIds = (answer?.indices ?? []).flatMap((optionIndex) => {
              const optionId = question.options[optionIndex]?.id
              return optionId ? [optionId] : []
            })
            return {
              questionId: question.id,
              optionIds: question.multiSelect || !other ? optionIds : [],
              ...(other ? { other } : {})
            }
          })
          if (grouped.every((answer) => answer.optionIds.length > 0 || answer.other)) {
            onRespond(prompt, encodeAgentSessionQuestionAnswers(grouped))
          }
          return
        }
        const index = answers[0]?.indices[0]
        const other = answers[0]?.other?.trim()
        const optionId =
          typeof index === 'number'
            ? body.options[index]?.id
            : body.freeTextQuestionId && other
              ? encodeQuestionAnswer(body.freeTextQuestionId, other)
              : undefined
        if (optionId) {
          onRespond(prompt, optionId)
        }
      }}
      onCancel={onCancelTurn}
    />
  )
}
