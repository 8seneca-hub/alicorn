import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

// Why: long enough to read and act on mid-task, short enough not to sit over the work forever.
const ESCALATION_TOAST_DURATION_MS = 30_000

function formatThousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

/**
 * Offers — never applies — a switch to orchestrated execution when a single-agent session crosses
 * the context ceiling. `single` staying the default is the whole point, so declining is free: the
 * offer is made once per task and the run continues untouched either way.
 */
export function EscalationOfferToaster(): null {
  useEffect(() => {
    return window.api.alicorn.onEscalationOffer((offer) => {
      toast(
        translate(
          'auto.components.alicorn.escalationOffer.message',
          'This task is at {{tokens}} tokens of context. Switch it to orchestrated?',
          { tokens: formatThousands(offer.contextTokens) }
        ),
        {
          duration: ESCALATION_TOAST_DURATION_MS,
          action: {
            label: translate(
              'auto.components.alicorn.escalationOffer.switch',
              'Switch to orchestrated'
            ),
            onClick: () => {
              void window.api.alicorn.setTaskExecutionStrategy({
                taskId: offer.taskId,
                strategy: 'orchestrated',
                // Why: recorded as `escalation`, not `user` — whether the offer was accepted is the
                // measurement this feature exists to produce.
                source: 'escalation'
              })
            }
          }
        }
      )
    })
  }, [])

  return null
}
