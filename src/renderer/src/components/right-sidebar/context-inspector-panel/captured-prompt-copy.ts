import { translate } from '@/i18n/i18n'
import type { CapturedPrompt } from '../../../../../shared/alicorn/run-inspector-view'

/** Matches PV1's tinted-outline badges so the two ledger panels read alike. */
export const CAPTURED_PROMPT_COLOR: Record<CapturedPrompt['kind'], string> = {
  inline: 'bg-sky-500/15 text-sky-500 border-sky-500/20',
  file: 'bg-violet-500/15 text-violet-500 border-violet-500/20',
  none: 'bg-muted text-muted-foreground/70 border-border'
}

export function formatPromptBytes(bytes: number): string {
  if (bytes < 1024) {
    return translate(
      'auto.components.right.sidebar.context.inspector.panel.bytes',
      '{{value0}} bytes',
      { value0: bytes }
    )
  }
  return translate('auto.components.right.sidebar.context.inspector.panel.kib', '{{value0}} KiB', {
    value0: (bytes / 1024).toFixed(1)
  })
}

/** The badge on a dispatch row: where its prompt is, in three words. */
export function capturedPromptLabel(prompt: CapturedPrompt): string {
  if (prompt.kind === 'inline') {
    return formatPromptBytes(prompt.bytes)
  }
  if (prompt.kind === 'file') {
    return translate(
      'auto.components.right.sidebar.context.inspector.panel.prompt.on.disk',
      'Prompt on disk'
    )
  }
  return translate(
    'auto.components.right.sidebar.context.inspector.panel.prompt.none.label',
    'Not captured'
  )
}

/**
 * The sentence this ticket exists for. A spilled prompt must never read as an empty one: the member
 * saw a full prompt, it was simply over the ledger's inline cap and was written to a file instead.
 */
export function capturedPromptSentence(prompt: CapturedPrompt): string {
  if (prompt.kind === 'file') {
    return translate(
      'auto.components.right.sidebar.context.inspector.panel.prompt.file.body',
      'This prompt was over the 64 KiB the ledger holds inline, so it was written to a file on the machine that ran the dispatch. The ledger stores the path, not the text — and not its length either, so no size is shown.'
    )
  }
  return translate(
    'auto.components.right.sidebar.context.inspector.panel.prompt.none.body',
    'No context capture was recorded for this dispatch, so there is no way to tell an underinformed member from a wrong one here.'
  )
}
