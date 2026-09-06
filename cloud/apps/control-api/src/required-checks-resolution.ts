import type { RequiredCheck } from '@alicorn-cloud/control-plane-contract'

export type ResolvedRequiredChecks = { checks: RequiredCheck[]; source: 'stage' | 'project' }

/**
 * Stage-authored checks win over the project's; the project scope is the fallback until stages
 * bind to runs (WF3, the consumer of this function) and can be deprecated at the v1.5 exit.
 *
 * A stage that authors an empty list is a deliberate "no checks at this stage" and still wins —
 * only a *missing* stage falls back, so a stage can never silently inherit a stricter project rule
 * it did not author. `source` is returned so the provenance line can say where they came from.
 */
export function resolveRequiredChecks(
  stageChecks: RequiredCheck[] | null | undefined,
  projectChecks: RequiredCheck[]
): ResolvedRequiredChecks {
  if (stageChecks == null) return { checks: projectChecks, source: 'project' }
  return { checks: stageChecks, source: 'stage' }
}
