// UI3's projection: one run, its dispatches, what each of them was actually given, and what it
// cost. Built from PV1's `ProvenanceView` rather than from the raw report — assembling provenance a
// second way is how two surfaces come to disagree about the same run.
//
// Nothing here carries prompt text. A run holds up to CONTEXT_CAPTURE_LIST_LIMIT captures whose
// prompts reach 64 KiB each, and this shape crosses IPC on every poll; a body is fetched for one
// dispatch, on demand, through `ContextCaptureRead`.

import type { ContextCaptureList, ContextCaptureRead, RunCost, StepOutcomeBackend } from './ledger'
import type {
  ProvenanceCheckView,
  ProvenanceGateView,
  ProvenanceStepView,
  ProvenanceView
} from './provenance-view'
import { summarizeRunCost, type RunCostByDispatch, type RunCostSummary } from './run-cost'

/**
 * Where a dispatch's prompt is, never what it says.
 *
 * `file` is the case this ticket exists to get right: the member *did* see a prompt, it was simply
 * over the 64 KiB inline cap and the write side spilled it to disk. Rendering that as an empty box
 * would say the opposite of what happened.
 *
 * Deliberately no byte count on `file`: `insertContextCapture` measures the inline prompt only, so
 * a spilled capture stores `prompt_bytes = 0`. Showing that as its size would be a lie; the path is
 * the whole of what the ledger knows.
 */
export type CapturedPrompt =
  | { kind: 'inline'; bytes: number }
  | { kind: 'file'; path: string }
  | { kind: 'none' }

export type RunInspectorDispatch = {
  dispatchId: string
  taskId: string
  stageKey: string
  member: string | null
  backend: StepOutcomeBackend
  outcome: 'succeeded' | 'failed'
  gate: ProvenanceGateView
  spendCents: number | null
  filesModified: number
  reportSummary: string
  prompt: CapturedPrompt
  /** When the capture was written; null when the dispatch captured nothing. */
  capturedAt: string | null
  checks: ProvenanceCheckView[]
  createdAt: string
}

/** Enough to name a run in a switcher without reading it. */
export type RunInspectorRunRef = {
  runId: string
  startedAt: string
  dispatchCount: number
}

export type RunInspectorView = {
  repoId: string
  branch: string
  /** Every run this branch's ledger steps belong to, newest first. */
  runs: RunInspectorRunRef[]
  /** The run being shown; empty string when the branch has no settled step at all. */
  runId: string
  dispatches: RunInspectorDispatch[]
  /** D7's summary, not a bare total: an unpriced backend makes the figure a floor. */
  cost: RunCostSummary
  /** The ledger capped the capture list, so some dispatches below read as uncaptured. */
  capturesTruncated: boolean
  /**
   * Dispatches the run's cost knows about that this branch's steps do not. Non-zero means the run
   * reached another repo or branch and what is listed here is a slice of it, not the whole run.
   */
  dispatchesOutsideBranch: number
}

/** Never rejects: the panel renders the failure, exactly as PV1's does. */
export type RunInspectorViewResult =
  | { ok: true; view: RunInspectorView }
  | { ok: false; error: string }

/** One dispatch's body, fetched only when a reader opens it. */
export type ContextCaptureDetailResult =
  | { ok: true; capture: ContextCaptureRead }
  | { ok: false; error: string }

/** Chars of a prompt rendered before the reader asks for the rest. See `previewPrompt`. */
export const PROMPT_PREVIEW_CHARS = 4_000

/**
 * A prompt at the 64 KiB cap is ~65k characters. One text node that size is fine; the reason to cut
 * it is that a wall of text is not readable, not that the DOM cannot hold it — so the cut is
 * reversible and always states what it hid.
 */
export function previewPrompt(prompt: string): { text: string; hiddenChars: number } {
  if (prompt.length <= PROMPT_PREVIEW_CHARS) {
    return { text: prompt, hiddenChars: 0 }
  }
  return {
    text: prompt.slice(0, PROMPT_PREVIEW_CHARS),
    hiddenChars: prompt.length - PROMPT_PREVIEW_CHARS
  }
}

function capturedPrompt(capture: ContextCaptureList['captures'][number] | undefined): CapturedPrompt {
  if (!capture) {
    return { kind: 'none' }
  }
  // Path first: the write side sets exactly one of the two, and a spilled capture is the half a
  // reader would otherwise mistake for an empty prompt.
  if (capture.promptPath) {
    return { kind: 'file', path: capture.promptPath }
  }
  if (typeof capture.prompt === 'string') {
    return { kind: 'inline', bytes: capture.promptBytes }
  }
  // Neither field set cannot come from `enqueueContextCapture`, and a row that holds no body and no
  // path says nothing more than a missing row does.
  return { kind: 'none' }
}

/** Runs the branch's steps belong to, newest first — the order the switcher offers them in. */
export function runsInProvenance(view: ProvenanceView): RunInspectorRunRef[] {
  const byRun = new Map<string, { startedAt: string; dispatches: Set<string> }>()
  for (const step of view.steps) {
    const existing = byRun.get(step.runId)
    if (!existing) {
      byRun.set(step.runId, { startedAt: step.createdAt, dispatches: new Set([step.dispatchId]) })
      continue
    }
    existing.dispatches.add(step.dispatchId)
    if (step.createdAt < existing.startedAt) {
      existing.startedAt = step.createdAt
    }
  }
  return [...byRun.entries()]
    .map(([runId, run]) => ({
      runId,
      startedAt: run.startedAt,
      dispatchCount: run.dispatches.size
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** The requested run when the branch has it, else its newest, else none. */
export function selectRunId(view: ProvenanceView, requested?: string | null): string {
  const runs = runsInProvenance(view)
  if (requested && runs.some((run) => run.runId === requested)) {
    return requested
  }
  return runs[0]?.runId ?? ''
}

function costSummary(cost: RunCost | null): RunCostSummary {
  if (!cost) {
    return { costUsd: null, partial: false }
  }
  // Reuses D7's rule rather than restating it: a dispatch we cannot price makes the total a floor.
  // `RunCost.totalSpendCents` cannot be used here — it sums nulls as zero.
  const byDispatch: RunCostByDispatch = {}
  for (const dispatch of cost.byDispatch) {
    byDispatch[dispatch.dispatchId] =
      dispatch.spendCents === null
        ? { costUsd: null, status: 'unavailable' }
        : { costUsd: dispatch.spendCents / 100, status: 'known' }
  }
  return summarizeRunCost(
    byDispatch,
    cost.byDispatch.map((dispatch) => dispatch.dispatchId)
  )
}

function dispatchRow(
  step: ProvenanceStepView,
  captures: Map<string, ContextCaptureList['captures'][number]>,
  checks: Map<string, ProvenanceCheckView[]>
): RunInspectorDispatch {
  const capture = captures.get(step.dispatchId)
  return {
    dispatchId: step.dispatchId,
    taskId: step.taskId,
    stageKey: step.stageKey,
    member: step.member,
    backend: step.backend,
    outcome: step.outcome,
    gate: step.gate,
    spendCents: step.spendCents,
    filesModified: step.filesModified,
    reportSummary: step.reportSummary,
    prompt: capturedPrompt(capture),
    capturedAt: capture?.createdAt ?? null,
    checks: checks.get(step.dispatchId) ?? [],
    createdAt: step.createdAt
  }
}

export function buildRunInspectorView(
  provenance: ProvenanceView,
  input: { runId: string; captures: ContextCaptureList | null; cost: RunCost | null }
): RunInspectorView {
  const steps = provenance.steps.filter((step) => step.runId === input.runId)
  const captures = new Map(
    (input.captures?.captures ?? []).map((capture) => [capture.dispatchId, capture] as const)
  )
  const checks = new Map<string, ProvenanceCheckView[]>()
  for (const check of provenance.checks) {
    const existing = checks.get(check.dispatchId)
    if (existing) {
      existing.push(check)
    } else {
      checks.set(check.dispatchId, [check])
    }
  }
  const branchDispatches = new Set(steps.map((step) => step.dispatchId))
  return {
    repoId: provenance.repoId,
    branch: provenance.branch,
    runs: runsInProvenance(provenance),
    runId: input.runId,
    dispatches: steps.map((step) => dispatchRow(step, captures, checks)),
    cost: costSummary(input.cost),
    capturesTruncated: input.captures?.truncated ?? false,
    dispatchesOutsideBranch: (input.cost?.byDispatch ?? []).filter(
      (dispatch) => !branchDispatches.has(dispatch.dispatchId)
    ).length
  }
}
