// What the gate panel is allowed to know about a pending gate. Shared so main and renderer
// cannot drift on the one field that decides whether a human sees the policy's opinion.

/**
 * ARCHITECTURE §7 *Levels*: level 1 — entered at runs ≥ 10 — is "gates, pre-fills a
 * recommendation, measures agreement". Below it the policy's decision is still recorded, and
 * still gates; it is simply not shown, which is what level 0 "Observed" means.
 */
export const ADVISORY_AUTONOMY_LEVEL = 1

export type GateVerdict = 'gate' | 'auto'

export type PendingGateView = {
  id: string
  taskId: string
  taskTitle: string | null
  question: string
  options: string[]
  createdAt: string
  /**
   * Present only once the member/stage has reached level 1. Below that it is withheld in the
   * main process rather than hidden in the renderer: a recommendation that never crosses the
   * boundary cannot be leaked by a rendering bug, and the level-0 answers stay uncontaminated.
   */
  recommendation: { decision: GateVerdict; reason: string } | null
  /** A recommendation exists, whether or not it is shown. Lets the panel say so honestly. */
  policyEvaluated: boolean
  /** The member's autonomy level when the gate opened; null when the policy was never asked. */
  autonomyLevel: number | null
  /**
   * The repository this gate belongs to, so a queue can be read one project at a time.
   * Null is a real answer, not a gap to paper over: a task that never dispatched and binds no
   * feature workspace has no repository to attribute, and guessing one would file the gate under
   * a project it has nothing to do with.
   */
  repoId: string | null
}

export type PendingGatesResult =
  | { ok: true; gates: PendingGateView[] }
  | { ok: false; error: string }

export type GateResolveResult =
  | { ok: true; agreementRecorded: boolean }
  | { ok: false; error: string }

export function isAdvisory(level: number | null): boolean {
  return level !== null && level >= ADVISORY_AUTONOMY_LEVEL
}
