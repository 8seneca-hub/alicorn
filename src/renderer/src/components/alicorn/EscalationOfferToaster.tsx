import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { EscalationOffer } from '../../../../shared/alicorn/escalation-offer'

// Why: long enough to read and act on mid-task, short enough not to sit over the work forever.
const ESCALATION_TOAST_DURATION_MS = 30_000

function formatThousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

/** Names the fact that raised the offer, so the user is answering a reason rather than a prompt. */
function offerMessage(offer: EscalationOffer): string {
  if (offer.signal === 'multi_repo') {
    return translate(
      'auto.components.alicorn.escalationOffer.multiRepoMessage',
      'This task spans {{repos}} repositories. Switch it to orchestrated?',
      { repos: offer.repoCount ?? 0 }
    )
  }
  return translate(
    'auto.components.alicorn.escalationOffer.message',
    'This task is at {{tokens}} tokens of context. Switch it to orchestrated?',
    { tokens: formatThousands(offer.contextTokens ?? 0) }
  )
}

/**
 * Offers — never applies — a switch to orchestrated execution when a single-agent task crosses the
 * context ceiling or spans more than one repository. `single` staying the default is the whole
 * point, so declining is free: the offer is made once per task, whichever signal raised it, and the
 * run continues untouched either way. The price is on the toast because orchestrated is a trade,
 * not an upgrade.
 */
export function EscalationOfferToaster(): null {
  useEffect(() => {
    return window.api.alicorn.onEscalationOffer((offer) => {
      toast(offerMessage(offer), {
        duration: ESCALATION_TOAST_DURATION_MS,
        description: translate(
          'auto.components.alicorn.escalationOffer.cost',
          'A lead plus its subagents costs roughly ten times the tokens.'
        ),
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
      })
    })
  }, [])

  return null
}
