/**
 * The shape of a conversation, drawn while the session opens.
 *
 * Opening a task does three reads before there is anything to show, and what stood here was a
 * spinner over an error line that had not settled yet — so the first thing a ticket showed was a
 * failure it was about to recover from. A skeleton says the same thing without claiming anything
 * went wrong: the frame is already correct, the content is still arriving.
 */
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

function SkeletonBar({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn('animate-pulse rounded bg-muted/60', className)} />
}

/** Alternating sides, so the outline reads as a conversation rather than a list. */
const BUBBLE_SKELETONS = [
  { id: 'brief', side: 'right', rows: ['w-3/4', 'w-2/3', 'w-1/2'] },
  { id: 'reply-1', side: 'left', rows: ['w-4/5', 'w-full', 'w-3/5'] },
  { id: 'reply-2', side: 'left', rows: ['w-2/3', 'w-1/2'] }
] as const

export function AlicornTaskChatSkeleton(): React.JSX.Element {
  return (
    <div
      className="scrollbar-sleek min-h-0 flex-1 space-y-6 overflow-hidden px-9 pt-6"
      // Why: aria-label on a roleless div is not exposed to screen readers.
      role="status"
      aria-busy="true"
      aria-label={translate('auto.components.alicorn.taskChat.opening', 'Opening the session…')}
    >
      {BUBBLE_SKELETONS.map((bubble) => (
        <div
          key={bubble.id}
          className={cn('flex', bubble.side === 'right' ? 'justify-end' : 'justify-start')}
        >
          <div
            className={cn(
              'w-full max-w-[560px] space-y-2 rounded-xl p-3.5',
              bubble.side === 'right' ? 'bg-muted/40' : 'border border-border/60'
            )}
          >
            {bubble.rows.map((row, index) => (
              <SkeletonBar key={`${bubble.id}-${index}`} className={cn('h-3.5', row)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
