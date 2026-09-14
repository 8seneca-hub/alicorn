/**
 * A task's session, in Alicorn's own chrome.
 *
 * The session is Alicorn's — the same structured agent session the workspace view hosts, reached by
 * the same controller — so the transcript, the approvals, the composer and every reconnect rule
 * are the ones that already work. What is Alicorn's is the frame: the chat sits *in the ticket*,
 * under the brief, with the task's status on it, instead of being somewhere you navigate to.
 *
 * `tabId` is not invented here. Creating a session publishes a tab for it on its worktree, and
 * `structuredAgentSessionTabId` is that tab's id — so the composer's drafts, file mentions and
 * pane commands resolve exactly as they do in the workspace view, and the two surfaces are the
 * same conversation rather than two views that drift.
 */
import React from 'react'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../../shared/structured-agent-session-projection'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'
import { translate } from '@/i18n/i18n'
import { setAlicornActiveWorkspace } from '../alicorn-active-workspace'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { dispatchStructuredAgentSessionComposerCommand } from '../../../../../shared/structured-agent-session-composer'
import { NativeChatComposer } from '@/components/native-chat/NativeChatComposer'
import { NativeChatEmptyState } from '@/components/native-chat/NativeChatEmptyState'
import { AlicornTaskChatSkeleton } from './AlicornTaskChatSkeleton'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { StructuredAgentSessionPromptCards } from '@/components/native-chat/StructuredAgentSessionPromptCards'
import { useStructuredAgentSession } from '@/components/native-chat/use-structured-agent-session'
import type { NativeChatLiveSession } from '@/components/native-chat/use-native-chat-live-session'
import type { AgentType } from '../../../../../shared/agent-status-types'
import type { TaskSessionActivity } from './task-session-activity'

const LOCAL_TARGET = { kind: 'local' } as const

export function AlicornTaskChat({
  session,
  className,
  onActivityChange,
  onRestart
}: {
  session: TaskSessionBinding
  className?: string
  /** Lifts the one reading of the session's state so the header cannot claim a different one. */
  onActivityChange?: (activity: TaskSessionActivity) => void
  /** Opens a fresh session on the same brief. The way back from a conversation that is gone. */
  onRestart?: () => void
}): React.JSX.Element {
  const agent = session.agent as AgentType
  const tabId = structuredAgentSessionTabId(session.sessionId)
  const paneKey = React.useMemo(
    () => structuredAgentSessionPaneKey(tabId, session.sessionId),
    [session.sessionId, tabId]
  )
  const controller = useStructuredAgentSession({
    sessionId: session.sessionId,
    target: LOCAL_TARGET,
    agent,
    isVisible: true
  })
  const prompt = controller.prompts[0] ?? null
  /** The window between opening a ticket and the journal's first page arriving. */
  const opening = controller.status === 'loading' && controller.messages.length === 0
  // `offline` is not cosmetic: with no fence the outbox cannot dispatch, so a message typed here
  // would sit queued with nothing said. Better to refuse the send than to swallow it.
  const activity: TaskSessionActivity = !controller.canSend
    ? 'offline'
    : prompt
      ? 'waiting'
      : controller.isWorking
        ? 'working'
        : 'idle'

  React.useEffect(() => {
    onActivityChange?.(activity)
  }, [activity, onActivityChange])

  // While this session is on screen, Alicorn has a workspace — which is what lets the right
  // sidebar's file tree, terminal and diff mean something. It has none anywhere else.
  React.useEffect(() => {
    setAlicornActiveWorkspace(session.worktreeId)
    return () => setAlicornActiveWorkspace(null)
  }, [session.worktreeId])
  const [composerError, setComposerError] = React.useState<string | null>(null)
  const [optionPickerRequest, setOptionPickerRequest] = React.useState<{
    id: string
    sequence: number
  } | null>(null)

  const live = React.useMemo<NativeChatLiveSession>(
    () => ({
      messages: controller.messages,
      status: controller.isWorking
        ? 'working'
        : controller.messages.length === 0
          ? 'empty'
          : 'ready',
      sessionId: session.sessionId,
      agent,
      hasMore: controller.hasOlder,
      loadingEarlier: controller.loadingOlder,
      loadEarlier: () => void controller.loadOlder(),
      readPhase: 'ready'
    }),
    [agent, controller, session.sessionId]
  )

  const stopTurn = (): void => {
    if (controller.turnId) {
      void controller.cancel(controller.turnId)
    }
  }

  return (
    <section className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        {controller.status === 'error' && controller.messages.length === 0 ? (
          // A session the host cannot find is usually one that was closed, or an install whose
          // agent-session records were cleared. The ticket is untouched, so the answer is a new
          // session on the same brief rather than an error with nowhere to go.
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center">
            <p className="text-[12.5px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.taskChat.gone',
                'This conversation is no longer on this machine.'
              )}
            </p>
            {onRestart ? (
              <Button size="sm" onClick={onRestart}>
                {translate('auto.components.alicorn.taskChat.restart', 'Start a new session')}
              </Button>
            ) : null}
          </div>
        ) : opening ? (
          <AlicornTaskChatSkeleton />
        ) : controller.messages.length === 0 ? (
          <NativeChatEmptyState kind="empty" agent={agent} />
        ) : (
          <NativeChatMessageList
            session={live}
            isWorking={controller.isWorking}
            expandSignal={false}
            fontScale={1}
            workingStartedAt={null}
            showTurnStatus
          />
        )}
      </div>

      <StructuredAgentSessionPromptCards
        prompt={prompt}
        onRespond={(pending, optionId) => void controller.respond(pending, optionId)}
        onCancelTurn={stopTurn}
      />

      {/* Nothing is wrong yet while the session is still opening: the first history read can refuse
          before the session is mounted and then succeed on its own, and showing that in red made a
          recoverable read look like a broken ticket. */}
      {!opening && (controller.error || composerError) ? (
        <p className="px-9 py-1 text-[11px] text-destructive">
          {controller.error ?? composerError}
        </p>
      ) : null}

      {prompt ? null : (
        <NativeChatComposer
          terminalTabId={tabId}
          paneKey={paneKey}
          targetPtyId={null}
          agent={agent}
          canSend={controller.canSend}
          isWorking={controller.isWorking}
          onStop={stopTurn}
          structuredTransport={{
            send: (text, attachments) =>
              controller.send(
                text,
                attachments.map((attachment) => ({
                  path: attachment.path,
                  previewUri: attachment.path
                }))
              ),
            dispatchCommand: (text) =>
              dispatchStructuredAgentSessionComposerCommand(text, {
                agent,
                snapshot: controller.optionSnapshot,
                invokeAction: async (id) => {
                  setOptionPickerRequest((current) => ({
                    id,
                    sequence: (current?.sequence ?? 0) + 1
                  }))
                  return true
                },
                setOption: controller.setStructuredOption
              }),
            optionsSurface: controller.optionSurface,
            optionSnapshot: controller.optionSnapshot,
            optionPickerRequest,
            worktreeId: session.worktreeId,
            onError: setComposerError,
            runtime: 'local'
          }}
        />
      )}
    </section>
  )
}
