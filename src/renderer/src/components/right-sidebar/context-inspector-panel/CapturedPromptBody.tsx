import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  previewPrompt,
  type CapturedPrompt
} from '../../../../../shared/alicorn/run-inspector-view'
import { capturedPromptSentence } from './captured-prompt-copy'
import { useContextCapture } from './use-context-inspector-state'

/**
 * What one dispatch was actually given. The body is fetched only while this is mounted — the run
 * read carries no prompt text at all, because a run can hold two hundred of them at 64 KiB each.
 */
export function CapturedPromptBody({
  runId,
  dispatchId,
  prompt
}: {
  runId: string
  dispatchId: string
  prompt: CapturedPrompt
}): React.JSX.Element {
  const result = useContextCapture(runId, prompt.kind === 'none' ? null : dispatchId)

  if (prompt.kind === 'none') {
    return <PromptNote text={capturedPromptSentence(prompt)} />
  }
  if (result === null) {
    return (
      <PromptNote
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.capture.loading',
          'Reading the capture…'
        )}
      />
    )
  }
  if (!result.ok) {
    return (
      <PromptNote
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.capture.unavailable',
          'The capture could not be read. Nothing is claimed about what this dispatch was given.'
        )}
        detail={result.error}
      />
    )
  }
  return (
    <div className="flex flex-col gap-2 pt-1">
      {prompt.kind === 'file' ? (
        <>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {capturedPromptSentence(prompt)}
          </p>
          <p
            className="font-mono text-[10px] break-all text-foreground"
            data-testid="captured-prompt-path"
          >
            {result.capture.promptPath ?? prompt.path}
          </p>
        </>
      ) : (
        <PromptText prompt={result.capture.prompt ?? ''} />
      )}
      <ContextSlice slice={result.capture.contextSlice} />
    </div>
  )
}

function PromptText({ prompt }: { prompt: string }): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false)
  const { text, hiddenChars } = previewPrompt(prompt)
  const shown = expanded ? prompt : text
  return (
    <div className="flex flex-col gap-1">
      <ScrollBlock text={shown} testId="captured-prompt-text" />
      {hiddenChars > 0 && !expanded ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 self-start px-2 text-xs"
          onClick={() => setExpanded(true)}
        >
          {translate(
            'auto.components.right.sidebar.context.inspector.panel.prompt.show.all',
            'Show the remaining {{value0}} characters',
            { value0: hiddenChars }
          )}
        </Button>
      ) : null}
    </div>
  )
}

function ContextSlice({ slice }: { slice: unknown }): React.JSX.Element | null {
  // `context_slice` is jsonb, so a malformed row could hold a scalar; only an object has entries.
  if (typeof slice !== 'object' || slice === null || Object.keys(slice).length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.slice.empty',
          'No context slice was recorded alongside the prompt.'
        )}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.slice.title',
          'Context slice'
        )}
      </h4>
      <ScrollBlock text={JSON.stringify(slice, null, 2)} testId="captured-context-slice" />
    </div>
  )
}

/**
 * One text node in a bounded scroller. Deliberately not split per line: 64 KiB of prompt is fine as
 * a single node and ruinous as sixteen hundred of them.
 */
function ScrollBlock({ text, testId }: { text: string; testId: string }): React.JSX.Element {
  return (
    <pre
      className="scrollbar-sleek max-h-64 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap text-foreground"
      data-testid={testId}
    >
      {text}
    </pre>
  )
}

function PromptNote({ text, detail }: { text: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <p className="text-[10px] leading-snug text-muted-foreground">{text}</p>
      {detail ? <p className="font-mono text-[10px] break-all">{detail}</p> : null}
    </div>
  )
}
