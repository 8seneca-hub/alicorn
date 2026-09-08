import type { WorkflowDraft } from './workflow-draft'

/**
 * What the Control API would reject, checked locally so the canvas can say so before a save round
 * trip. Hand-mirrored from `WorkflowInputSchema.superRefine` in the contract package.
 *
 * The API stays the authority — this never gates a save on its own opinion. It exists because a
 * zod issue path arriving as a 400 cannot be pointed at a shape on screen, and because the two
 * mistakes this ticket is about (an edge labelled `correction` that does not return, a stage key
 * renamed out from under a track record) are ones a human should see while authoring.
 */
export type DraftIssue = {
  /** Matches the contract's message so a 400 and a local issue read the same. */
  code: string
  /** What the issue is attached to, so the canvas can highlight it. */
  target:
    | { kind: 'stage'; key: string }
    | { kind: 'transition'; from: string; to: string }
    | { kind: 'graph' }
}

const STAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

const MAX_STAGES = 40
const MAX_TRANSITIONS = 200

function stageIssues(draft: WorkflowDraft): DraftIssue[] {
  const issues: DraftIssue[] = []
  const seen = new Set<string>()
  for (const stage of draft.stages) {
    const target = { kind: 'stage', key: stage.key } as const
    if (!STAGE_KEY_PATTERN.test(stage.key)) {
      issues.push({ code: 'invalid_stage_key', target })
    }
    if (seen.has(stage.key)) {
      issues.push({ code: 'duplicate_stage_key', target })
    }
    seen.add(stage.key)
    if (stage.kind === 'code' && !stage.codeCommand?.trim()) {
      issues.push({ code: 'code_stage_requires_command', target })
    }
    if (stage.kind === 'code' && stage.memberId) {
      issues.push({ code: 'code_stage_takes_no_member', target })
    }
  }
  const ordinals = draft.stages.map((stage) => stage.ordinal).sort((a, b) => a - b)
  if (ordinals.some((ordinal, i) => ordinal !== i)) {
    issues.push({ code: 'ordinals_must_be_contiguous_from_zero', target: { kind: 'graph' } })
  }
  return issues
}

function transitionIssues(draft: WorkflowDraft): DraftIssue[] {
  const issues: DraftIssue[] = []
  const ordinalByKey = new Map(draft.stages.map((stage) => [stage.key, stage.ordinal]))
  const edges = new Set<string>()
  const triggered = new Set<string>()
  for (const transition of draft.transitions) {
    const target = { kind: 'transition', from: transition.from, to: transition.to } as const
    const from = ordinalByKey.get(transition.from)
    const to = ordinalByKey.get(transition.to)
    if (from === undefined || to === undefined) {
      issues.push({ code: 'unknown_stage_key', target })
      continue
    }
    if (transition.from === transition.to) {
      issues.push({ code: 'self_transition', target })
    }
    const edge = `${transition.from}->${transition.to}`
    if (edges.has(edge)) {
      issues.push({ code: 'duplicate_transition', target })
    }
    edges.add(edge)
    // One edge per (from, trigger) — two would make dispatch a coin toss.
    const fired = `${transition.from}:${transition.trigger.kind}`
    if (triggered.has(fired)) {
      issues.push({ code: 'ambiguous_trigger', target })
    }
    triggered.add(fired)
    // The kind is what the canvas draws, so an edge may not claim a direction it does not run in.
    if (transition.kind === 'correction' && to >= from) {
      issues.push({ code: 'correction_edge_must_return', target })
    }
    if (transition.kind === 'forward' && to < from) {
      issues.push({ code: 'forward_edge_must_not_return', target })
    }
  }
  return issues
}

export function validateDraft(draft: WorkflowDraft): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (!draft.name.trim()) {
    issues.push({ code: 'name_required', target: { kind: 'graph' } })
  }
  if (draft.stages.length === 0) {
    issues.push({ code: 'stages_required', target: { kind: 'graph' } })
  }
  if (draft.stages.length > MAX_STAGES) {
    issues.push({ code: 'too_many_stages', target: { kind: 'graph' } })
  }
  if (draft.transitions.length > MAX_TRANSITIONS) {
    issues.push({ code: 'too_many_transitions', target: { kind: 'graph' } })
  }
  return [...issues, ...stageIssues(draft), ...transitionIssues(draft)]
}

export function issuesForStage(issues: readonly DraftIssue[], key: string): DraftIssue[] {
  return issues.filter((issue) => issue.target.kind === 'stage' && issue.target.key === key)
}

export function issuesForTransition(
  issues: readonly DraftIssue[],
  from: string,
  to: string
): DraftIssue[] {
  return issues.filter(
    (issue) =>
      issue.target.kind === 'transition' && issue.target.from === from && issue.target.to === to
  )
}

/**
 * Stage keys that would stop being measurable if the draft were saved (SK1).
 *
 * A track record accumulates under the stage key, so a renamed key starts an empty window and the
 * old evidence stays behind on a key nothing dispatches any more. The canvas warns with this;
 * it never blocks, because renaming a stage is sometimes exactly what the human means to do.
 */
export function renamedStageKeys(
  saved: readonly { key: string }[],
  draft: WorkflowDraft
): string[] {
  const drafted = new Set(draft.stages.map((stage) => stage.key))
  return saved.map((stage) => stage.key).filter((key) => !drafted.has(key))
}
