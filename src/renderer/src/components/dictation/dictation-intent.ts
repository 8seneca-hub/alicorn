import type { DictationInsertionTarget } from './dictation-insertion-target'

export type DictationRoute = 'agent_prompt' | 'insert'

export type DictationIntent = {
  route: DictationRoute
  /** The transcript asks for something irreversible, so delivery waits for confirmation. */
  destructive: boolean
}

// Decision 6's list, verbatim. Deliberately short: every entry here costs an interruption when it
// fires, so the bar is "irreversible", not "writes something". Kept as source text rather than one
// pre-built regex so the two-word entries can also match how they are actually spoken.
const DESTRUCTIVE_PHRASES = [
  'delete',
  'drop',
  'remove',
  'rm',
  'reset --hard',
  'force push',
  'deploy',
  'destroy'
] as const

// Why not \b around the whole phrase: 'reset --hard' starts with a word char but contains dashes,
// and \b before '-' behaves differently than before a letter. Anchor on the word characters at
// each end instead, and let the interior accept spaces, dashes or both.
const DESTRUCTIVE_PATTERNS = DESTRUCTIVE_PHRASES.map((phrase) => {
  const interior = phrase
    .split(' ')
    // Speech-to-text writes what was said, so '--hard' arrives as 'hard'; accept either.
    .map((word) => word.replace(/^-+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((word) => word.length > 0)
    .join('[\\s-]*-*[\\s-]*')
  return new RegExp(`(?<![\\w-])${interior}(?![\\w-])`, 'i')
})

export function isDestructiveDictation(text: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Where a finished transcript goes, and whether it may go there unattended.
 *
 * An agent pane gets the text as a *prompt* — never as keystrokes into its PTY — so the agent
 * receives one turn instead of a half-typed line (CLAUDE.md → *Interface decisions*). Everything
 * else keeps the legacy insert. Routing and destructiveness are independent: a shell insert of
 * "rm the build output" earns the same confirmation an agent prompt would.
 */
export function classifyDictation(
  text: string,
  target: DictationInsertionTarget | null,
  { isAgentSession }: { isAgentSession: boolean }
): DictationIntent {
  const route: DictationRoute =
    target?.kind === 'terminal' && isAgentSession ? 'agent_prompt' : 'insert'
  return { route, destructive: isDestructiveDictation(text) }
}
