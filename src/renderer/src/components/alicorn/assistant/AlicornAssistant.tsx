/**
 * The assistant: one session, summoned over whatever you are looking at.
 *
 * It replaced a Chat *screen* for a reason worth keeping. Chat-as-a-page makes you navigate away
 * from the thing you are asking about — you are on a board, you want a member added to it, and you
 * have to leave the board to ask and come back to see whether it happened. Opening over the page
 * fixes both halves: you keep your place, and the panel knows where you are.
 *
 * Docked, not modal, for the same reason: the payoff of "add a member" is watching it appear.
 *
 * One session for the life of the app, not one per screen. It is an assistant, so it keeps what it
 * knows as you move; a scope change is something it is *told*, never something it is restarted for.
 */
import React from 'react'
import { PanelRightClose, Sparkles } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { AlicornTaskChat } from '../screens/AlicornTaskChat'
import { useOrgChat } from '../screens/use-org-chat'
import { useStructuredAgentSession } from '@/components/native-chat/use-structured-agent-session'
import { AlicornReceipts } from './AlicornReceipts'
import { collectReceipts } from './alicorn-receipt-feed'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'
import type { AgentType } from '../../../../../shared/agent-status-types'
import type { Project } from '../../../../../shared/alicorn/projects'
import {
  getAlicornAssistantState,
  setAlicornAssistantOpen,
  subscribeAlicornAssistant
} from './alicorn-assistant-store'

export function useAlicornAssistantState(): ReturnType<typeof getAlicornAssistantState> {
  return useSyncExternalStore(
    subscribeAlicornAssistant,
    getAlicornAssistantState,
    getAlicornAssistantState
  )
}

function ScopeChip({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="truncate rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  )
}

/**
 * The session plus the record of what it changed.
 *
 * Split from the panel so the transcript subscription lives with the receipts it feeds: they read
 * the same messages, and reading them in two places would mean subscribing twice.
 */
function AlicornAssistantSession({
  session,
  onRestart
}: {
  session: TaskSessionBinding
  onRestart: () => void
}): React.JSX.Element {
  const controller = useStructuredAgentSession({
    sessionId: session.sessionId,
    target: { kind: 'local' },
    agent: session.agent as AgentType,
    isVisible: true
  })
  const receipts = React.useMemo(() => collectReceipts(controller.messages), [controller.messages])

  return (
    <>
      <AlicornTaskChat session={session} onRestart={onRestart} />
      <AlicornReceipts entries={receipts} />
    </>
  )
}

export function AlicornAssistant({
  projects
}: {
  projects: readonly Project[]
}): React.JSX.Element | null {
  const { open, scope } = useAlicornAssistantState()
  const chat = useOrgChat(projects)

  // Mounted only while open: the session survives in the control plane and reattaches, so there is
  // nothing to keep alive here, and an unmounted panel is not holding a subscription open.
  if (!open) {
    return null
  }

  const scopeLabel =
    scope.taskRef ??
    scope.projectName ??
    translate('auto.components.alicorn.assistant.org', 'All projects')

  return (
    <aside
      className="flex w-[420px] max-w-[92vw] shrink-0 flex-col border-l border-border bg-background"
      aria-label={translate('auto.components.alicorn.assistant.label', 'Alicorn assistant')}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[12.5px] font-semibold">
          {translate('auto.components.alicorn.assistant.title', 'Assistant')}
        </span>
        <ScopeChip label={scopeLabel} />
        <span className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          aria-label={translate('auto.components.alicorn.assistant.close', 'Close assistant')}
          onClick={() => setAlicornAssistantOpen(false)}
        >
          <PanelRightClose className="size-3.5" />
        </Button>
      </header>

      {chat.session ? (
        <AlicornAssistantSession session={chat.session} onRestart={chat.restart} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12.5px] text-muted-foreground">
          {chat.repoId === undefined
            ? translate(
                'auto.components.alicorn.assistant.noRepo',
                'The assistant runs in a workspace, and no project has a repository resolved on this machine yet.'
              )
            : (chat.error ??
              translate('auto.components.alicorn.assistant.opening', 'Opening the assistant…'))}
        </div>
      )}
    </aside>
  )
}

/**
 * The way in when you are not already thinking in shortcuts.
 *
 * Bottom right, over the content, because that is where a decade of chat widgets has taught people
 * to look for one.
 */
export function AlicornAssistantTrigger({
  shortcutLabel
}: {
  shortcutLabel: string
}): React.JSX.Element | null {
  const { open } = useAlicornAssistantState()
  if (open) {
    return null
  }
  return (
    <button
      type="button"
      onClick={() => setAlicornAssistantOpen(true)}
      title={translate('auto.components.alicorn.assistant.openWith', 'Assistant ({{shortcut}})', {
        shortcut: shortcutLabel
      })}
      aria-label={translate('auto.components.alicorn.assistant.open', 'Open the assistant')}
      className={cn(
        'fixed bottom-5 right-5 z-30 flex size-11 items-center justify-center rounded-full',
        'border border-border bg-background shadow-lg transition hover:bg-accent'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Sparkles className="size-4" />
    </button>
  )
}
