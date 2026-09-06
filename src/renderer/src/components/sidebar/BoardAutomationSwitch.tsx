import React, { useCallback, useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { BoardAutomationStatusView } from '../../../../preload/api/board-automation-api'

const REFUSAL_LABELS: Record<string, string> = {
  refused_ceiling: 'hit the dispatch ceiling',
  refused_loop: 'looked like a loop',
  refused_killed: 'automation was off'
}

function describeRefusal(refusal: NonNullable<BoardAutomationStatusView['lastRefusal']>): string {
  const reason = REFUSAL_LABELS[refusal.outcome] ?? refusal.outcome
  return translate(
    'auto.components.sidebar.BoardAutomationSwitch.lastRefusal',
    'Last refused on {{column}}: {{reason}}',
    { column: refusal.toStatusId, reason }
  )
}

/**
 * The board's visible on/off switch.
 *
 * Deliberately in the header rather than buried in settings: automation that dispatches paid agents
 * should be stoppable from the surface where you notice it misbehaving. It also shows the last
 * refusal, because "on, but nothing is happening" is the state people actually hit.
 */
export default function BoardAutomationSwitch({
  repoId
}: {
  repoId: string | null
}): React.JSX.Element | null {
  const [status, setStatus] = useState<BoardAutomationStatusView | null>(null)

  const refresh = useCallback(async () => {
    if (!repoId) {
      setStatus(null)
      return
    }
    setStatus(await window.api.boardAutomation.status({ repoId }))
  }, [repoId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onChange = useCallback(
    async (enabled: boolean) => {
      if (!repoId) {
        return
      }
      // Optimistic: the switch is a safety control, so it must feel immediate. The refresh below
      // reconciles with what main actually stored.
      setStatus((current) => (current ? { ...current, killed: !enabled } : current))
      await window.api.boardAutomation.setKilled({ repoId, killed: !enabled })
      await refresh()
    },
    [repoId, refresh]
  )

  if (!repoId || !status) {
    return null
  }

  // Why disabled rather than hidden: a board switched on locally while a global stop stands is off,
  // and hiding the control would leave no way to see why.
  const globallyOff = status.globalDisabledAt !== null
  const label = status.killed
    ? translate('auto.components.sidebar.BoardAutomationSwitch.off', 'Automation off')
    : translate('auto.components.sidebar.BoardAutomationSwitch.on', 'Automation on')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={!status.killed}
            disabled={globallyOff}
            onCheckedChange={(checked) => void onChange(checked)}
            aria-label={translate(
              'auto.components.sidebar.BoardAutomationSwitch.ariaLabel',
              'Board automation'
            )}
          />
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {globallyOff
          ? translate(
              'auto.components.sidebar.BoardAutomationSwitch.globallyOff',
              'Automation is stopped for every board. Resume it with: orca board-automation resume'
            )
          : status.lastRefusal
            ? describeRefusal(status.lastRefusal)
            : translate(
                'auto.components.sidebar.BoardAutomationSwitch.hint',
                'Moving a card to a column with a rule dispatches its member.'
              )}
      </TooltipContent>
    </Tooltip>
  )
}
