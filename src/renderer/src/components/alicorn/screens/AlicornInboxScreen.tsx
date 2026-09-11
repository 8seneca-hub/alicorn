/**
 * The queue, as a place rather than a sidebar panel.
 *
 * It reuses GatePanel outright: resolving a gate is the same act here as it is in the sidebar, and
 * a second implementation of it would be a second thing to keep honest about what a resolution
 * records.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'
import { GatePanel } from '../../right-sidebar/gate-panel/GatePanel'
import { AlicornEmptyState, AlicornScreenHeader } from './AlicornScreenChrome'

export function AlicornInboxScreen({
  gates,
  projectId,
  projectName
}: {
  gates: PendingGateView[] | null
  onResolved: () => void
  /** Null is the cross-project queue; a project id narrows the crumb, not the list. */
  projectId: string | null
  projectName?: string
}): React.JSX.Element {
  const waiting = gates?.length ?? 0
  return (
    <>
      <AlicornScreenHeader
        crumbs={projectId ? ['Alicorn', projectName ?? projectId] : ['Alicorn']}
        title={translate('auto.components.alicorn.shell.inbox', 'Inbox')}
      />
      {gates !== null && waiting === 0 ? (
        <AlicornEmptyState
          title={translate('auto.components.alicorn.inbox.clearTitle', 'Nothing is waiting on you')}
          detail={translate(
            'auto.components.alicorn.inbox.clearDetail',
            'A step that needs a decision appears here. Every one you resolve stays on the ledger — the point is to need fewer of them, not to hide them.'
          )}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <GatePanel />
        </div>
      )}
    </>
  )
}
