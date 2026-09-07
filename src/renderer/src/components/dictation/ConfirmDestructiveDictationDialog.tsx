import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export type PendingDestructiveDictation = {
  text: string
  target: { tabId: string; ptyId: string }
}

/**
 * Last stop before a dictated transcript that asks for something irreversible reaches an agent.
 * Shows the transcript verbatim: speech-to-text mishears, and the point of the pause is to let the
 * user see what would actually be sent rather than what they meant to say.
 */
export function ConfirmDestructiveDictationDialog({
  pending,
  onConfirm,
  onCancel
}: {
  pending: PendingDestructiveDictation | null
  onConfirm: (pending: PendingDestructiveDictation) => void
  onCancel: () => void
}): React.JSX.Element | null {
  if (!pending) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.dictation.ConfirmDestructiveDictationDialog.title',
              'Send this to the agent?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.dictation.ConfirmDestructiveDictationDialog.body',
              'This dictated instruction asks for something that cannot be undone.'
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md bg-muted px-3 py-2 text-sm break-words">
          {pending.text}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate(
              'auto.components.dictation.ConfirmDestructiveDictationDialog.discard',
              'Discard'
            )}
          </Button>
          <Button onClick={() => onConfirm(pending)}>
            {translate('auto.components.dictation.ConfirmDestructiveDictationDialog.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
