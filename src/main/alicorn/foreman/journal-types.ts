import type {
  ForemanNodeStatus,
  ForemanPlanNode,
  ForemanRunStatus
} from '../../../shared/alicorn/foreman-run'

// The Feature Journal is the source of truth for an orchestrated run; the lead's context is a cache
// of it (docs/alicorn/foreman-templates.md §3). It lives on disk so a run survives the session that
// started it — ARCHITECTURE's "state is on disk" for Foreman.

// The run vocabulary lives in shared/alicorn/foreman-run.ts, because the renderer draws what this
// file parses; these names are the journal's spelling of the same things.
export type JournalNodeStatus = ForemanNodeStatus
export type JournalStatus = ForemanRunStatus

/**
 * `files` is the node's *declared* footprint — the paths the lead intends this node to touch.
 *
 * Journal-side only, and deliberately not on `ForemanPlanNode`: the run view does not draw it, and
 * two nodes declaring the same path is a scheduling fact rather than something a panel renders.
 */
export type JournalNode = ForemanPlanNode & { files: string[] }

/** A path two or more nodes of one wave declared: false independence, caught before dispatch. */
export type JournalWaveOverlap = { path: string; nodeIds: string[] }

export type JournalWave = {
  n: number
  nodeIds: string[]
  /** Worktree-relative path of the reduced table, or null until the whole wave has settled. */
  reducedPath: string | null
  overlaps: JournalWaveOverlap[]
}

export type JournalDecision = {
  n: number
  decision: string
  chosen: string
  why: string
  reversible: boolean
}

export type JournalAssumption = {
  n: number
  assumption: string
  blastRadius: string
  dependents: string[]
}

export type JournalLogEntry = { at: string; line: string }

export type Journal = {
  runId: string
  objective: string
  status: JournalStatus
  startedAt: string
  budgetCents: number | null
  spentCents: number | null
  decisions: JournalDecision[]
  assumptions: JournalAssumption[]
  plan: JournalNode[]
  /** Derived from the plan, not authored: `planWaves` recomputes it on every journal write. */
  waves: JournalWave[]
  contractRegistry: string
  log: JournalLogEntry[]
  notDone: string[]
}

export class JournalParseError extends Error {
  /** Section the parse gave up in, so a malformed journal says where to look. */
  section: string

  constructor(section: string, message: string) {
    super(`${section}: ${message}`)
    this.name = 'JournalParseError'
    this.section = section
  }
}
