/**
 * A task's session, in Alicorn's own chrome.
 *
 * The session is Orca's — the same structured agent session the workspace view hosts, reached by
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
import { Loader2, Square } from 'lucide-react'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../../shared/structured-agent-session-projection'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { dispatchStructuredAgentSessionComposerCommand } from '../../../../../shared/structured-agent-session-composer'
import { NativeChatComposer } from '@/components/native-chat/NativeChatComposer'
import { NativeChatEmptyState } from '@/components/native-chat/NativeChatEmptyState'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { StructuredAgentSessionPromptCards } from '@/components/native-chat/StructuredAgentSessionPromptCards'
import { useStructuredAgentSession } from '@/components/native-chat/use-structured-agent-session'
import type { NativeChatLiveSession } from '@/components/native-chat/use-native-chat-live-session'
import type { AgentType } from '../../../../../shared/agent-status-types'

const LOCAL_TARGET = { kind: 'local' } as const

function statusLabel(isWorking: boolean, waiting: boolean): string {
  if (waiting) {
    return translate('auto.components.alicorn.taskChat.waiting', 'Waiting on you')
  }
  return isWorking
    ? translate('auto.components.alicorn.taskChat.working', 'Working')
    : translate('auto.components.alicorn.taskChat.idle', 'Idle')
}

export function AlicornTaskChat({
  session,
  className,
  onRestart
}: {
  session: TaskSessionBinding
  className?: string
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
      <div className="flex shrink-0 items-center gap-2 px-9 pt-3 text-[11px] text-muted-foreground">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            prompt
              ? 'bg-status-attention'
              : controller.isWorking
                ? 'bg-status-running'
                : 'bg-muted-foreground/40'
          )}
        />
        <span className="min-w-0 flex-1 truncate">
          {statusLabel(controller.isWorking, prompt !== null)}
        </span>
        {controller.isWorking ? (
          <Button size="xs" variant="ghost" className="gap-1" onClick={stopTurn}>
            <Square className="size-3" />
            {translate('auto.components.alicorn.taskChat.stop', 'Stop')}
          </Button>
        ) : null}
      </div>

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
        ) : controller.status === 'loading' && controller.messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {translate('auto.components.alicorn.taskChat.opening', 'Opening the session…')}
          </div>
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

      {controller.error || composerError ? (
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
          canSend
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
