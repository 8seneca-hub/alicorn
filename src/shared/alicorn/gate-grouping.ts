/**
 * Grouping the gate queue so it can be read one project at a time.
 *
 * A gate carries the repository it belongs to, or null when nothing places it — a task that binds
 * no feature workspace and never dispatched. Those go last rather than first: an unattributed gate
 * is the least actionable thing in the queue, and leading with it would push the work someone can
 * actually do below the fold.
 */
import type { PendingGateView } from './gate-review'

export type GateGroup = {
  /** Null is the unattributed group — real, and deliberately last. */
  repoId: string | null
  gates: PendingGateView[]
}

/**
 * Groups by repository, named groups first in the order `repoName` sorts them.
 *
 * Sorting on the displayed name rather than the id keeps the queue in the order a human reads the
 * sidebar, instead of an internal id order that looks arbitrary on screen.
 */
export function groupGatesByRepo(
  gates: readonly PendingGateView[],
  repoName: (repoId: string) => string
): GateGroup[] {
  const byRepo = new Map<string, PendingGateView[]>()
  const unattributed: PendingGateView[] = []

  for (const gate of gates) {
    if (gate.repoId === null) {
      unattributed.push(gate)
      continue
    }
    const existing = byRepo.get(gate.repoId)
    if (existing) {
      existing.push(gate)
    } else {
      byRepo.set(gate.repoId, [gate])
    }
  }

  const named = [...byRepo.entries()]
    .sort(([a], [b]) => repoName(a).localeCompare(repoName(b)))
    .map(([repoId, groupGates]): GateGroup => ({ repoId, gates: groupGates }))

  return unattributed.length > 0 ? [...named, { repoId: null, gates: unattributed }] : named
}
