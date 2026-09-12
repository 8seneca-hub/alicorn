/**
 * The project chat before its session exists.
 *
 * Only three states reach here and none of them is a button: the session is opening, it refused,
 * or the project has nowhere to run one. Opening the screen is what starts it.
 */
import React from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { AlicornEmptyState, AlicornScreenBody } from './AlicornScreenChrome'

export function AlicornProjectChatStarting({
  starting,
  error,
  hasRepo
}: {
  starting: boolean
  error: string | null
  hasRepo: boolean
}): React.JSX.Element {
  if (!hasRepo) {
    return (
      <AlicornScreenBody>
        <AlicornEmptyState
          title={translate(
            'auto.components.alicorn.project.chatNoRepoTitle',
            'Nowhere to run a session'
          )}
          detail={translate(
            'auto.components.alicorn.project.chatNoRepo',
            'A session needs somewhere to run, and this project has no repository resolved on this machine.'
          )}
        />
      </AlicornScreenBody>
    )
  }

  if (error) {
    return (
      <AlicornScreenBody>
        <AlicornEmptyState
          title={translate(
            'auto.components.alicorn.project.chatFailedTitle',
            'The chat did not open'
          )}
          detail={error}
        />
      </AlicornScreenBody>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
      {starting ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {translate('auto.components.alicorn.project.chatOpening', 'Opening the project chat…')}
    </div>
  )
}
