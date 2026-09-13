/**
 * The four levels, and what each one is in terms the policy actually stores.
 *
 * A level is presentation over `(mode, minRuns, minAcceptRate)` — it is not a fifth field. Storing
 * a level *and* the fields it implies would be two answers to one question, and the evaluator reads
 * the fields.
 *
 * The mapping is not arbitrary; each level's description is a statement about evidence:
 *
 *  - **L0 · propose everything** — `always_gate`. Every step waits.
 *  - **L1 · auto-apply reversible** — `evidence` with no bar to clear. Reversible steps run at once;
 *    anything irreversible is still proposed, because reversibility is checked *before* policy and
 *    no level can reach it.
 *  - **L2 · auto-apply, notify** — `evidence` at the shipped bar. Runs once the ledger says it has
 *    earned it, which is what "needs a track record" means.
 *  - **L3 · autonomous** — `never_gate`, which the contract and a CHECK constraint both require an
 *    expiry for. A standing exception that never lapses is the one thing §9 refuses.
 *
 * **Hard stops still gate at every level**, including L3 — `gateReasonFor` reads `reversibility`
 * and `inheritedCost` before it looks at a policy at all. That is the sentence the prototype puts
 * under L3, and it is true by construction rather than by being remembered.
 */
import { DEFAULT_AUTONOMY_POLICY } from './gate-policy'
import type { AutonomyPolicy, AutonomyPolicyInput } from './gate-policy'

export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

export const AUTONOMY_LEVEL_COPY: Record<AutonomyLevel, { title: string; detail: string }> = {
  L0: {
    title: 'L0 · propose everything',
    detail: 'Every step waits for you. The starting point for a new project.'
  },
  L1: {
    title: 'L1 · auto-apply reversible',
    detail: 'Reversible steps run; anything irreversible is proposed.'
  },
  L2: {
    title: 'L2 · auto-apply, notify',
    detail: 'Runs and tells you after. Needs a track record in the ledger.'
  },
  L3: {
    title: 'L3 · autonomous',
    detail: 'Runs unattended. Hard stops still gate, always.'
  }
}

/** What a stage gets when nobody has authored anything — the contract's own shipped default. */
export const ORG_DEFAULT_LEVEL: AutonomyLevel = 'L2'

/** How long an L3 exception stands before it lapses. §9: a standing exception always expires. */
const NEVER_GATE_DAYS = 30

export function levelOfPolicy(
  policy: Pick<AutonomyPolicy, 'mode' | 'minRuns'> | null
): AutonomyLevel {
  if (!policy) {
    return ORG_DEFAULT_LEVEL
  }
  if (policy.mode === 'always_gate') {
    return 'L0'
  }
  if (policy.mode === 'never_gate') {
    return 'L3'
  }
  return policy.minRuns === 0 ? 'L1' : 'L2'
}

export function policyForLevel(args: {
  level: AutonomyLevel
  stageKey: string
  memberId?: string | null
  now?: () => number
}): AutonomyPolicyInput {
  const base = {
    stageKey: args.stageKey,
    memberId: args.memberId ?? null,
    ...DEFAULT_AUTONOMY_POLICY
  }
  if (args.level === 'L0') {
    return { ...base, mode: 'always_gate' }
  }
  if (args.level === 'L1') {
    // No bar to clear: a reversible step does not need a track record to be worth running.
    return { ...base, mode: 'evidence', minRuns: 0, minAcceptRate: 0 }
  }
  if (args.level === 'L3') {
    const at = new Date((args.now?.() ?? Date.now()) + NEVER_GATE_DAYS * 86_400_000)
    return { ...base, mode: 'never_gate', expiresAt: at.toISOString() }
  }
  return { ...base, mode: 'evidence' }
}
