/**
 * The org chat screen: one session, the whole library in reach.
 *
 * It takes the page rather than sitting in a card, for the same reason a task's session does —
 * what you came here to do is talk, and everything else is a distraction from it.
 */
import React from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { Project } from '../../../../../shared/alicorn/projects'
import { AlicornEmptyState } from './AlicornScreenChrome'
import { AlicornTaskChat } from './AlicornTaskChat'
import { useOrgChat } from './use-org-chat'

export function AlicornOrgChat({ projects }: { projects: readonly Project[] }): React.JSX.Element {
  const chat = useOrgChat(projects)

  if (chat.session) {
    return <AlicornTaskChat session={chat.session} onRestart={chat.restart} />
  }

  if (!chat.loading && !chat.repoId) {
    return (
      <AlicornEmptyState
        title={translate('auto.components.alicorn.org.chatNoRepoTitle', 'Nowhere to run a session')}
        detail={translate(
          'auto.components.alicorn.org.chatNoRepo',
          'A session runs in a workspace, and no project has a repository resolved on this machine yet. Bind one to a project and the chat opens here.'
        )}
      />
    )
  }

  if (chat.error) {
    return (
      <AlicornEmptyState
        title={translate('auto.components.alicorn.org.chatFailedTitle', 'The chat did not open')}
        detail={chat.error}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {translate('auto.components.alicorn.org.chatOpening', 'Opening the org chat…')}
    </div>
  )
}
