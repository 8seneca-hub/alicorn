/**
 * The vocabulary of an orchestrated run, shared because both halves need it: main parses it out of
 * the journal on disk, the renderer draws it.
 *
 * The journal itself stays main-side — it carries decisions, assumptions, the contract registry and
 * a log, none of which the view draws, and shipping all of it across IPC every poll would spend
 * context and bandwidth on text nobody reads. `ForemanRunView` is the slice that is drawn.
 */

export type ForemanNodeStatus = 'pending' | 'dispatched' | 'done' | 'failed' | 'blocked'

// The template writes `planning`/`blocked`; the plan's interface writes `paused`/`failed`. Both are
// kept: a hand-written journal must parse, and a resumed run needs to tell paused from failed.
export type ForemanRunStatus = 'planning' | 'running' | 'paused' | 'blocked' | 'done' | 'failed'

export type ForemanPlanNode = {
  id: string
  title: string
  owner: string
  dependsOn: string[]
  status: ForemanNodeStatus
  model: string | null
  /** Null until the node is dispatched, which is also what makes it cost nothing yet. */
  dispatchId: string | null
}

export type ForemanRunView = {
  runId: string
  objective: string
  status: ForemanRunStatus
  startedAt: string
  budgetCents: number | null
  plan: ForemanPlanNode[]
}

/** What the journal read can tell the view, including the two ways it can have nothing to show. */
export type ForemanRunViewResult =
  | { state: 'ready'; run: ForemanRunView }
  /** No `.foreman/` journal here — this workspace is not running an orchestrated task. */
  | { state: 'none' }
  /** A journal exists but does not parse; the section names where to look. */
  | { state: 'unreadable'; reason: string }
