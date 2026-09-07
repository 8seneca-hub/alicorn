import { useCallback, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { submitPromptToAgentPty } from '@/lib/agent-paste-draft'
import { classifyDictation } from './dictation-intent'
import {
  decideAgentPromptDelivery,
  resolveAgentPromptTarget
} from './dictation-agent-prompt-delivery'
import { formatFinalTranscriptSegment } from './dictation-final-segments'
import type { DictationInsertionTarget } from './dictation-insertion-target'
import type { PendingDestructiveDictation } from './ConfirmDestructiveDictationDialog'

/** Referentially stable for the component's lifetime, so the controller's IPC-listener effect and
 *  startDictation callback do not tear down and re-subscribe on every render. */
export type DictationAgentPromptActions = {
  /** Resolve this session's agent target from the focused pane. Call once, at start. */
  beginSession: (target: DictationInsertionTarget | null) => void
  /** Accumulate a final segment. True when consumed, so the caller skips the legacy insert. */
  bufferSegment: (text: string) => boolean
  /** Deliver (or discard) the buffer once dictation has stopped. */
  deliver: (sessionErrored: boolean) => void
  confirm: (pending: PendingDestructiveDictation) => void
  cancel: () => void
}

export type DictationAgentPrompt = {
  actions: DictationAgentPromptActions
  pending: PendingDestructiveDictation | null
}

/**
 * The agent-prompt half of dictation: buffer this session's final segments and submit them as one
 * prompt when it stops.
 *
 * Why buffered: `onFinalTranscript` fires once per segment and an agent prompt is delivered as
 * paste-then-Enter, so inserting per segment would submit several partial turns for one dictated
 * sentence. Separate from `DictationController` because the controller owns the session lifecycle
 * and this owns the prompt — and because the two together exceed the file's line budget.
 */
export function useDictationAgentPrompt(): DictationAgentPrompt {
  const bufferRef = useRef('')
  const targetRef = useRef<{ tabId: string; ptyId: string } | null>(null)
  const [pending, setPending] = useState<PendingDestructiveDictation | null>(null)

  const beginSession = useCallback((target: DictationInsertionTarget | null) => {
    // Resolved at start: the focused pane is authority for where this session's speech goes, and
    // the user may click elsewhere while still talking.
    targetRef.current = resolveAgentPromptTarget(useAppStore.getState(), target)
    bufferRef.current = ''
  }, [])

  const bufferSegment = useCallback((text: string) => {
    if (!targetRef.current) {
      return false
    }
    bufferRef.current += formatFinalTranscriptSegment(text, bufferRef.current)
    return true
  }, [])

  const deliver = useCallback((sessionErrored: boolean) => {
    const text = bufferRef.current
    const target = targetRef.current
    bufferRef.current = ''
    targetRef.current = null
    if (!target) {
      return
    }
    const decision = decideAgentPromptDelivery({
      buffer: text,
      sessionErrored,
      destructive: classifyDictation(text, null, { isAgentSession: true }).destructive,
      confirmBeforeDestructive: useAppStore.getState().settings?.voice?.confirmBeforeDestructive
    })
    if (decision === 'discard') {
      return
    }
    if (decision === 'confirm') {
      setPending({ text: text.trim(), target })
      return
    }
    void submitPromptToAgentPty({ tabId: target.tabId, ptyId: target.ptyId, content: text.trim() })
  }, [])

  const confirm = useCallback((confirmed: PendingDestructiveDictation) => {
    setPending(null)
    void submitPromptToAgentPty({
      tabId: confirmed.target.tabId,
      ptyId: confirmed.target.ptyId,
      content: confirmed.text
    })
  }, [])

  const cancel = useCallback(() => setPending(null), [])

  // Why memoized on the callbacks alone: `pending` changes when the dialog opens, and an effect
  // keyed on this object would re-register the speech IPC listeners at that moment.
  const actions = useMemo(
    () => ({ beginSession, bufferSegment, deliver, confirm, cancel }),
    [beginSession, bufferSegment, deliver, confirm, cancel]
  )
  return { actions, pending }
}
