import type { JournalNode, JournalWaveOverlap } from './journal-types'

/**
 * False independence is the failure mode this file exists for.
 *
 * Two nodes with no edge between them look parallel, and the graph runs them in one wave — but if
 * they touch the same file the independence was never real, and nobody finds out until the merge.
 * `planWaves` splits them into successive waves up front; `holdsForFileOverlap` is the same rule
 * applied one dispatch at a time, which is how the coordinator actually schedules.
 *
 * Everything here is pure: the whole point is that the overlap is provable without a live run.
 */

export type PlannedWave = { n: number; nodeIds: string[]; overlaps: JournalWaveOverlap[] }

/** Why a node did not go out with the wave it otherwise belonged to. */
export type WaveHold = { nodeId: string; path: string; blockedBy: string }

const SETTLED_STATUSES: ReadonlySet<string> = new Set(['done', 'failed'])

// Node ids are hand-written as often as generated ('1', '2', '10'), and plain lexicographic order
// would put 10 before 2 — making "earlier id first" mean something different per run.
function compareNodeIds(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true })
}

function byNodeId(left: JournalNode, right: JournalNode): number {
  return compareNodeIds(left.id, right.id)
}

/** A node declaring the same path twice is still one claim on it. */
function declaredFiles(node: JournalNode): string[] {
  return [...new Set(node.files.map((path) => path.trim()).filter(Boolean))]
}

/** Paths declared by two or more of `nodes`, each with the nodes that declared it. */
export function declaredFileOverlaps(nodes: readonly JournalNode[]): JournalWaveOverlap[] {
  const byPath = new Map<string, string[]>()
  for (const node of [...nodes].sort(byNodeId)) {
    for (const path of declaredFiles(node)) {
      const claimants = byPath.get(path)
      if (claimants) {
        claimants.push(node.id)
      } else {
        byPath.set(path, [node.id])
      }
    }
  }
  return [...byPath.entries()]
    .filter(([, nodeIds]) => nodeIds.length > 1)
    .map(([path, nodeIds]) => ({ path, nodeIds }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

/**
 * Layers the plan by `dependsOn`, ignoring edges to nodes that are not in it.
 *
 * A dependency cycle would otherwise spin here forever, so the nodes left when no layer can be
 * formed go out as one final layer: a malformed plan still produces waves a lead can read, and the
 * cycle shows up as a suspiciously fat last wave rather than as a hung coordinator.
 */
function topologicalLayers(nodes: readonly JournalNode[]): JournalNode[][] {
  const known = new Set(nodes.map((node) => node.id))
  const remaining = new Map(nodes.map((node) => [node.id, node]))
  const placed = new Set<string>()
  const layers: JournalNode[][] = []

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dep) => !known.has(dep) || placed.has(dep)))
      .sort(byNodeId)
    const layer = ready.length > 0 ? ready : [...remaining.values()].sort(byNodeId)
    for (const node of layer) {
      remaining.delete(node.id)
      placed.add(node.id)
    }
    layers.push(layer)
  }
  return layers
}

/**
 * Topological waves by `dependsOn`; within a wave, nodes whose declared files overlap are split
 * into successive waves.
 *
 * The split is greedy in id order, so it is deterministic: the earlier id keeps the wave it was in
 * and the later one moves down. An overlap is recorded on every wave holding one of its nodes,
 * which is what makes the split legible in the journal — wave 2 says why node 2 is not in wave 1.
 */
export function planWaves(nodes: readonly JournalNode[]): PlannedWave[] {
  const waves: PlannedWave[] = []
  for (const layer of topologicalLayers(nodes)) {
    const overlaps = declaredFileOverlaps(layer)
    const claimedPerWave: Set<string>[] = []
    const buckets: string[][] = []

    for (const node of layer) {
      const files = declaredFiles(node)
      let index = claimedPerWave.findIndex((claimed) => files.every((path) => !claimed.has(path)))
      if (index === -1) {
        index = claimedPerWave.length
        claimedPerWave.push(new Set())
        buckets.push([])
      }
      for (const path of files) {
        claimedPerWave[index]!.add(path)
      }
      buckets[index]!.push(node.id)
    }

    for (const nodeIds of buckets) {
      waves.push({
        n: waves.length + 1,
        nodeIds,
        overlaps: overlaps.filter((overlap) =>
          overlap.nodeIds.some((nodeId) => nodeIds.includes(nodeId))
        )
      })
    }
  }
  return waves
}

/**
 * Which of `candidateIds` must wait, because a path they declared is already claimed.
 *
 * A path is claimed by a node that is currently `dispatched`, or by an admitted candidate that
 * sorts earlier. Nothing else claims: a `pending` node the coordinator has not offered cannot hold
 * anything, and a settled node has released everything. That is what makes this deadlock-free —
 * the earliest candidate is only ever held by work that is already running, and running work
 * settles.
 *
 * A held candidate claims nothing itself, so a third node that clashes only with the held one still
 * goes out in this wave.
 */
export function holdsForFileOverlap(
  nodes: readonly JournalNode[],
  candidateIds: readonly string[]
): WaveHold[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const candidates = candidateIds
    .map((id) => byId.get(id))
    .filter((node): node is JournalNode => node !== undefined)
    .sort(byNodeId)
  const candidateIdSet = new Set(candidates.map((node) => node.id))

  const claimedBy = new Map<string, string>()
  for (const node of [...nodes].sort(byNodeId)) {
    if (node.status !== 'dispatched' || candidateIdSet.has(node.id)) {
      continue
    }
    for (const path of declaredFiles(node)) {
      if (!claimedBy.has(path)) {
        claimedBy.set(path, node.id)
      }
    }
  }

  const holds: WaveHold[] = []
  for (const node of candidates) {
    const files = declaredFiles(node)
    const clash = files.find((path) => claimedBy.has(path))
    if (clash !== undefined) {
      holds.push({ nodeId: node.id, path: clash, blockedBy: claimedBy.get(clash)! })
      continue
    }
    for (const path of files) {
      claimedBy.set(path, node.id)
    }
  }
  return holds
}

/** True once every node of the wave has reached a terminal status. */
export function isWaveSettled(nodes: readonly JournalNode[], nodeIds: readonly string[]): boolean {
  const statusById = new Map(nodes.map((node) => [node.id, node.status]))
  return nodeIds.every((nodeId) => SETTLED_STATUSES.has(statusById.get(nodeId) ?? 'pending'))
}
