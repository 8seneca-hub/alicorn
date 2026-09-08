import type { ForemanReport } from '../../../shared/alicorn/foreman-report'

/**
 * The Contract Registry: the typed interfaces that cross between nodes of an orchestrated run.
 *
 * Never "contract ledger" — `Ledger` is the append-only measurement ledger and nothing else
 * (CLAUDE.md, *Naming*). This structure has the opposite profile: it is rewritten in place, it lives
 * in the run's journal on disk, and it dies with the run.
 *
 * Why it exists: a worker that needs a neighbouring interface today either reads the whole thing or
 * is told it in prose. Both are expensive and both drift. One entry is ~200 tokens of extracted,
 * typed contract instead of a 40k-token conversation.
 */

/**
 * Where an entry came from, and therefore how much it is worth.
 *
 * `extracted` was read out of an OpenAPI document or a type declaration — a fact about the repo.
 * `declared` is a model's assertion in a report's `interface_delta`, believed only as far as the
 * model is. A reader who cannot tell them apart will trust the wrong one, so this is a column of the
 * rendered table, not a comment.
 */
export type ContractProvenance = 'extracted' | 'declared'

export type ContractEntry = {
  /** Repo the interface belongs to; empty on a single-repo run. */
  repo: string
  /** `endpoint`, `type`, `interface`, `enum` — free-form, matching a report's `interface_delta.kind`. */
  kind: string
  name: string
  /** The contract itself, clamped to the per-entry ceiling. */
  shape: string
  provenance: ContractProvenance
  /** `openapi.yaml#/paths/…` or `contracts/api.ts:42` when extracted; `node 3` when declared. */
  source: string
  breaking: boolean
}

/**
 * A repo whose interfaces could not be extracted, and what would have to be generated first.
 *
 * PROJECT-BRIEF §12 calls schema generation a precondition rather than a nice-to-have, and this is
 * the shape of that precondition. An empty registry with no gap recorded reads as "this repo has no
 * interfaces", which is a different and much more dangerous claim than "nobody could extract them".
 */
export type ContractGap = {
  repo: string
  /** What is absent — the finding. */
  missing: string
  /** What would have to exist before extraction could work — the ask. */
  generate: string
}

export type ContractRegistry = {
  entries: ContractEntry[]
  gaps: ContractGap[]
  /** Prose the lead wrote by hand. Preserved verbatim so a coordinator write cannot erase it. */
  notes: string
}

/** ~200 tokens per endpoint is the whole economic claim; a shape that overruns it is clamped. */
export const CONTRACT_ENTRY_MAX_TOKENS = 200
export const CONTRACT_ENTRY_MAX_CHARS = CONTRACT_ENTRY_MAX_TOKENS * 4

/**
 * How many entries one registry may hold.
 *
 * Enforced when merging rather than when rendering: the journal is read-modify-write, so an entry
 * dropped at render time is an entry deleted from disk. Refusing at the door loses nothing that was
 * already recorded, and the caller logs what it refused.
 */
export const CONTRACT_REGISTRY_MAX_ENTRIES = 200

export function emptyContractRegistry(): ContractRegistry {
  return { entries: [], gaps: [], notes: '' }
}

export function isContractRegistryEmpty(registry: ContractRegistry): boolean {
  return registry.entries.length === 0 && registry.gaps.length === 0 && registry.notes === ''
}

/** Collapses whitespace and clamps, so one entry costs about what it promises to cost. */
export function clampShape(shape: string, max = CONTRACT_ENTRY_MAX_CHARS): string {
  const flat = shape.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Identity is repo + name, not kind: an extractor's `endpoint` and a model's `route` are one thing. */
function entryKey(entry: Pick<ContractEntry, 'repo' | 'name'>): string {
  return `${entry.repo.trim().toLowerCase()}::${entry.name.trim().toLowerCase()}`
}

/**
 * True when `incoming` may overwrite `existing`.
 *
 * Evidence beats assertion: an extracted entry replaces a declared one, and a declared one never
 * replaces an extracted one. Otherwise the later write wins, which is what makes a re-scan pick up
 * a changed schema.
 */
function supersedes(incoming: ContractEntry, existing: ContractEntry): boolean {
  if (incoming.provenance === existing.provenance) {
    return true
  }
  return incoming.provenance === 'extracted'
}

export type ContractMergeResult = {
  added: number
  replaced: number
  /** Entries turned away at `CONTRACT_REGISTRY_MAX_ENTRIES`; the caller says so out loud. */
  refused: number
}

/** Merges entries into the registry in place, newest-wins except where evidence outranks assertion. */
export function mergeContractEntries(
  registry: ContractRegistry,
  incoming: readonly ContractEntry[],
  maxEntries = CONTRACT_REGISTRY_MAX_ENTRIES
): ContractMergeResult {
  const index = new Map(registry.entries.map((entry, position) => [entryKey(entry), position]))
  const result: ContractMergeResult = { added: 0, replaced: 0, refused: 0 }

  for (const raw of incoming) {
    const entry: ContractEntry = { ...raw, shape: clampShape(raw.shape) }
    const position = index.get(entryKey(entry))
    if (position === undefined) {
      if (registry.entries.length >= maxEntries) {
        result.refused++
        continue
      }
      index.set(entryKey(entry), registry.entries.length)
      registry.entries.push(entry)
      result.added++
      continue
    }
    const existing = registry.entries[position]!
    if (supersedes(entry, existing)) {
      registry.entries[position] = entry
      result.replaced++
    }
  }
  return result
}

/** Gaps are deduplicated on repo: one repo has one schema-generation story, not a growing list. */
export function mergeContractGaps(
  registry: ContractRegistry,
  incoming: readonly ContractGap[]
): number {
  let changed = 0
  for (const gap of incoming) {
    const position = registry.gaps.findIndex((existing) => existing.repo === gap.repo)
    if (position === -1) {
      registry.gaps.push(gap)
      changed++
      continue
    }
    if (registry.gaps[position]!.missing !== gap.missing) {
      registry.gaps[position] = gap
      changed++
    }
  }
  return changed
}

/** A repo that has since been extracted from is no longer a repo that needs a schema generated. */
export function clearContractGap(registry: ContractRegistry, repo: string): void {
  registry.gaps = registry.gaps.filter((gap) => gap.repo !== repo)
}

/**
 * The agent-declared fallback: a report's `interface_delta`, marked as the assertion it is.
 *
 * This is the path a repo with no schema takes, and the reason `provenance` is on the row rather
 * than in a comment — the entries look identical otherwise.
 */
export function contractEntriesFromReport(
  nodeId: string,
  report: ForemanReport,
  repo = ''
): ContractEntry[] {
  return report.interface_delta.map((delta) => ({
    repo,
    kind: delta.kind,
    name: delta.name,
    shape: clampShape(delta.shape),
    provenance: 'declared' as const,
    source: `node ${nodeId}`,
    breaking: delta.breaking
  }))
}
