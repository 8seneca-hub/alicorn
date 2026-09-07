import { LEAD_CONTEXT_CEILING_FRACTION, type LeadContextCeiling } from './lead-context-ceiling'

/**
 * What a lead is told when it reaches the ceiling. Fixed text, not a template the lead can argue
 * with: the instruction is to move state to disk and keep working, never to stop and ask.
 *
 * "Continue reading only the journal" is the whole point — the journal is the source of truth and
 * the context is a cache of it (`docs/alicorn/foreman-templates.md` §3), so a lead that has
 * flushed everything worth keeping can shed the rest without losing the run.
 */
export function buildLeadCompactionPrompt(ceiling: LeadContextCeiling): string {
  const percent = Math.round(LEAD_CONTEXT_CEILING_FRACTION * 100)
  return [
    `Your context has reached ${formatTokens(ceiling.contextTokens)} tokens, past the ${percent}% ceiling of your ${formatTokens(ceiling.windowTokens)}-token window.`,
    '',
    'Before your next dispatch, bring the journal fully up to date under `.foreman/<task-id>/journal.md`:',
    '- every decision taken since the last write, with its reason and whether it is reversible',
    '- every assumption you made without asking, and which plan nodes depend on it',
    '- the plan table: node status, owner, model, dispatch id',
    '- the contract registry: interface deltas from reports that later nodes build against',
    '',
    'Then run /compact and continue from the journal alone. Do not re-read subagent reports or',
    'implementation to reconstruct what you just wrote down — if it is not in the journal, it was',
    'not worth keeping. You still write no code and read no implementation.',
    '',
    'The remaining window is where your subagents’ reports land. Keep it free.'
  ].join('\n')
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens)
}
