// The Feature Journal is the source of truth for an orchestrated run; the lead's context is a cache
// of it (docs/alicorn/foreman-templates.md §3). It lives on disk so a run survives the session that
// started it — ARCHITECTURE's "state is on disk" for Foreman.

export type JournalNodeStatus = 'pending' | 'dispatched' | 'done' | 'failed' | 'blocked'

export type JournalNode = {
  id: string
  title: string
  owner: string
  dependsOn: string[]
  status: JournalNodeStatus
  model: string | null
  dispatchId: string | null
}

// The template writes `planning`/`blocked` and the plan's interface writes `paused`/`failed`. Both
// are kept: a hand-written journal must parse, and a resumed run needs to tell paused from failed.
export type JournalStatus = 'planning' | 'running' | 'paused' | 'blocked' | 'done' | 'failed'

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
