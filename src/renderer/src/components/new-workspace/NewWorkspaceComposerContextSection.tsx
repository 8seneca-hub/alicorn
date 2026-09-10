/**
 * Context, and what Alicorn would do with it.
 *
 * The textarea is the composer's existing `note` field, promoted out of Advanced: it was already
 * the place a developer wrote what the agent could not read off the repo, it was just one row tall
 * and behind a disclosure. Everything below it is the plan — stated, with its reasons, and
 * overridable — so that starting a task costs a title and a sentence.
 */
import React from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES,
  measureTextControlPasteByteLength,
  pasteTextIntoTextControl,
  shouldHandleTextControlPaste
} from '@/lib/text-control-paste'
import { describePlanReason, isBlockingPlanReason } from '@/lib/composer-task-plan-copy'
import type { ComposerTaskPlanState } from '@/hooks/use-composer-task-plan'
import { translate } from '@/i18n/i18n'
import type { Member } from '../../../../shared/alicorn/members'

type Props = {
  note: string
  onNoteChange: (value: string) => void
  taskPlan: ComposerTaskPlanState
  repoName: (id: string) => string
}

function MemberSelect({
  label,
  value,
  candidates,
  onChange
}: {
  label: string
  value: string | null
  candidates: Member[]
  onChange: (id: string) => void
}): React.JSX.Element | null {
  if (candidates.length === 0) {
    return null
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-full min-w-0 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((member) => (
            <SelectItem key={member.id} value={member.id} className="text-xs">
              {`${member.name} · ${member.backend}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

export function NewWorkspaceComposerContextSection({
  note,
  onNoteChange,
  taskPlan,
  repoName
}: Props): React.JSX.Element {
  const [overrideOpen, setOverrideOpen] = React.useState(false)

  // Moved with the field it guards: a paste larger than the direct limit goes through the chunked
  // path instead of freezing the renderer on one enormous synchronous insert.
  const handleNotePaste = React.useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    const byteLengthMeasurement = measureTextControlPasteByteLength(text, {
      stopAfterBytes: TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES
    })
    if (
      !byteLengthMeasurement.exceededLimit &&
      !shouldHandleTextControlPaste(text, { measuredByteLength: byteLengthMeasurement.byteLength })
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const textarea = event.currentTarget
    void pasteTextIntoTextControl(textarea, text, {
      source: 'clipboard',
      canContinue: (target) => target.ownerDocument.activeElement === target
    })
      .then((result) => {
        if (result.status === 'rejected' && result.reason === 'too-large') {
          toast.error(
            translate(
              'auto.components.NewWorkspaceComposerCard.notePasteTooLarge',
              'Paste is too large for the note field.'
            )
          )
        }
      })
      .catch(() => {})
  }, [])

  const { plan, members, pinned } = taskPlan
  const names = React.useMemo(
    () => ({ memberName: taskPlan.memberName, repoName }),
    [taskPlan.memberName, repoName]
  )
  const developers = members.filter((member) => member.role === 'developer')
  const reviewers = members.filter((member) => member.role === 'reviewer' || member.role === 'qa')

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor="composer-task-context"
        >
          {translate('auto.components.composerTaskPlan.contextLabel', 'Context')}
        </label>
        <textarea
          id="composer-task-context"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onPaste={handleNotePaste}
          placeholder={translate(
            'auto.components.composerTaskPlan.contextPlaceholder',
            'Anything the agent cannot read off the repo — the constraint, the edge case, the decision already made.'
          )}
          rows={3}
          className="w-full min-w-0 resize-none overflow-y-auto scrollbar-sleek rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [field-sizing:content] max-h-40"
        />
      </div>

      {plan ? (
        <div
          data-testid="composer-task-plan"
          className={cn(
            'space-y-1 rounded-md border px-3 py-2 text-xs',
            plan.reviewerConflict
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border/60 bg-muted/30'
          )}
        >
          <ul className="space-y-0.5">
            {plan.reasons.map((reason) => (
              <li
                key={reason.kind}
                className={cn(
                  isBlockingPlanReason(reason) ? 'text-status-attention' : 'text-muted-foreground'
                )}
              >
                {describePlanReason(reason, names)}
              </li>
            ))}
          </ul>
          {pinned ? (
            <div className="flex items-center justify-between gap-2 pt-1 text-muted-foreground">
              <span>
                {translate(
                  'auto.components.composerTaskPlan.pinned',
                  'You changed the plan, so it has stopped adjusting.'
                )}
              </span>
              <button
                type="button"
                className="shrink-0 underline underline-offset-2 hover:text-foreground"
                onClick={taskPlan.unpin}
              >
                {translate('auto.components.composerTaskPlan.unpin', 'Let it decide again')}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="pt-1 underline underline-offset-2 text-muted-foreground hover:text-foreground"
            onClick={() => setOverrideOpen((open) => !open)}
            aria-expanded={overrideOpen}
          >
            {overrideOpen
              ? translate('auto.components.composerTaskPlan.hideOverrides', 'Hide')
              : translate(
                  'auto.components.composerTaskPlan.showOverrides',
                  'Change who works on this'
                )}
          </button>
          {overrideOpen ? (
            <div className="space-y-1 pt-1">
              <MemberSelect
                label={translate('auto.components.composerTaskPlan.builds', 'Builds')}
                value={taskPlan.authorId}
                candidates={developers}
                onChange={taskPlan.setAuthorId}
              />
              <MemberSelect
                label={translate('auto.components.composerTaskPlan.reviews', 'Reviews')}
                value={taskPlan.reviewerId}
                candidates={reviewers}
                onChange={taskPlan.setReviewerId}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
