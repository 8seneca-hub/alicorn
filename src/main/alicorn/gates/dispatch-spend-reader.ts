import { attributeDispatchUsage } from '../run-usage-attribution'
import { backendFromWorkerStartOptions } from '../step-outcome-builder'
import type { ClaudeUsageStore } from '../../claude-usage/store'
import type { CodexUsageStore } from '../../codex-usage/store'
import type { DispatchSpendReader } from './run-blast-radius'

export type DispatchSpendReaderDeps = {
  // Why lazy: the usage stores are created after the runtime, so they are read at call time.
  claudeUsage: () => Pick<ClaudeUsageStore, 'getAutomationRunUsage'> | null
  codexUsage: () => Pick<CodexUsageStore, 'getAutomationRunUsage'> | null
}

/**
 * What one dispatch cost, for BR1's per-run spend budget.
 *
 * The same attribution C5 posts to the ledger, so the number a budget is checked against and the
 * number the ledger records cannot disagree. A backend Alicorn does not price returns null, which
 * makes the run's total null and gates: cost attribution shows "—", never a guess, and an
 * unpriceable run must not be able to spend its way past a ceiling unobserved.
 */
export function createDispatchSpendReader(deps: DispatchSpendReaderDeps): DispatchSpendReader {
  return async (dispatch) => {
    const patch = await attributeDispatchUsage({
      backend: dispatch.memberBackend ?? backendFromWorkerStartOptions(dispatch.startOptions),
      worktreeId: dispatch.worktreeId,
      startedAt: dispatch.dispatchedAt,
      completedAt: dispatch.completedAt,
      claudeUsage: deps.claudeUsage(),
      codexUsage: deps.codexUsage()
    })
    return patch.spendCents
  }
}
