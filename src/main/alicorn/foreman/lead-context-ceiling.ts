import { claudeContextWindowTokens } from '../../../shared/alicorn/model-windows'

/**
 * A lead compacts at 40% of its window, far earlier than a worker's 300k escalation ceiling
 * (`shared/alicorn/context-ceiling.ts`), and for a different reason.
 *
 * A worker's ceiling is a *quality* limit — it fires where quality starts to degrade. A lead's is a
 * *capacity* limit: the remaining 60% is the room the reports it exists to synthesize have to land
 * in. A lead that has filled its window has nowhere to put the returns, and re-planning is the one
 * thing it cannot do badly.
 */
export const LEAD_CONTEXT_CEILING_FRACTION = 0.4

export type LeadContextCeiling = {
  contextTokens: number
  windowTokens: number
  ceilingTokens: number
  atCeiling: boolean
}

/**
 * Null means "no verdict" — an unreadable transcript or a model whose window we do not know. The
 * lead is left alone in that case: prompting a compaction we cannot justify would cost the run a
 * turn and teach the lead to ignore the prompt.
 */
export function evaluateLeadContextCeiling(input: {
  contextTokens: number | null
  model: string | null | undefined
}): LeadContextCeiling | null {
  const windowTokens = claudeContextWindowTokens(input.model)
  if (input.contextTokens === null || windowTokens === null) {
    return null
  }
  const ceilingTokens = Math.floor(windowTokens * LEAD_CONTEXT_CEILING_FRACTION)
  return {
    contextTokens: input.contextTokens,
    windowTokens,
    ceilingTokens,
    atCeiling: input.contextTokens >= ceilingTokens
  }
}
