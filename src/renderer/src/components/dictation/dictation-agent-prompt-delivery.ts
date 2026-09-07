import type { DictationInsertionTarget } from './dictation-insertion-target'

type AgentPromptTargetState = {
  tabsByWorktree: Record<string, readonly { id: string; launchAgent?: string }[]>
  ptyIdsByTabId: Record<string, readonly string[]>
}

/**
 * The PTY a dictated transcript may be delivered to as an agent prompt, or null to fall back to
 * the legacy insert.
 *
 * Deliberately narrow: only a terminal tab that was launched with an agent **and** currently has a
 * single pane qualifies. A split inside an agent tab can be a plain shell, and the insertion target
 * carries the DOM's numeric pane id rather than the pane key's leaf id — so there is no cheap way
 * to tell which half of a split is focused. Sending "ls -la" to an agent as a prompt is a worse
 * failure than typing a sentence into a shell, so ambiguity falls back to typing.
 */
export function resolveAgentPromptTarget(
  state: AgentPromptTargetState,
  target: DictationInsertionTarget | null
): { tabId: string; ptyId: string } | null {
  if (target?.kind !== 'terminal') {
    return null
  }
  const tab = Object.values(state.tabsByWorktree)
    .flat()
    .find((candidate) => candidate.id === target.tabId)
  if (!tab?.launchAgent) {
    return null
  }
  const ptyIds = state.ptyIdsByTabId[target.tabId] ?? []
  return ptyIds.length === 1 && ptyIds[0] ? { tabId: target.tabId, ptyId: ptyIds[0] } : null
}

export type DictationDeliveryDecision =
  /** Send the buffered transcript to the agent now. */
  | 'submit'
  /** Ask first — the transcript asks for something irreversible. */
  | 'confirm'
  /** Deliver nothing, and drop the buffer. */
  | 'discard'

/**
 * What to do with a buffered agent prompt when dictation stops.
 *
 * Why buffered at all: `onFinalTranscript` fires once per *segment*, and an agent prompt is
 * delivered as paste-then-Enter. Submitting per segment would turn one dictated sentence into
 * three partial turns, so the agent route accumulates and delivers once, here.
 *
 * A session that errored discards its buffer: the transcript is very likely truncated mid-sentence,
 * and a half-heard instruction submitted to an agent is worse than one that never arrives. Same for
 * a cancelled session — the user aborting is not a request to send what they had said so far.
 */
export function decideAgentPromptDelivery({
  buffer,
  sessionErrored,
  destructive,
  confirmBeforeDestructive
}: {
  buffer: string
  sessionErrored: boolean
  destructive: boolean
  /** Absent in profiles written before the setting existed; treated as on. */
  confirmBeforeDestructive: boolean | undefined
}): DictationDeliveryDecision {
  if (sessionErrored || buffer.trim().length === 0) {
    return 'discard'
  }
  // Why `!== false`: opting out has to be explicit, so an older profile (undefined) still confirms.
  return destructive && confirmBeforeDestructive !== false ? 'confirm' : 'submit'
}
