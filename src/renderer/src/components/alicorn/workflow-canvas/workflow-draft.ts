import type {
  TransitionKind,
  TriggerKind,
  WorkflowGraphInput,
  WorkflowStage,
  WorkflowTransition
} from '../../../../../shared/alicorn/workflows'

/**
 * The graph the canvas is editing, and the pure operations that change it.
 *
 * Every operation returns a new draft, so undo is a stack of these and nothing mutates behind a
 * render. Nothing here talks to the Control API — saving is the pane's job, and the Control API
 * stays the authority on what is legal.
 */
export type WorkflowDraft = WorkflowGraphInput

/** A safe stage: `contained` and `low` are the defaults ARCHITECTURE §7 says to start from. */
export function newStage(key: string, ordinal: number): WorkflowStage {
  return {
    key,
    name: '',
    ordinal,
    memberId: null,
    columnId: null,
    kind: 'worker',
    codeCommand: null,
    reversibility: 'contained',
    inheritedCost: 'low',
    requiredChecks: []
  }
}

function recompact(stages: readonly WorkflowStage[]): WorkflowStage[] {
  return [...stages]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((stage, ordinal) => (stage.ordinal === ordinal ? stage : { ...stage, ordinal }))
}

export function patchStage(
  draft: WorkflowDraft,
  key: string,
  patch: Partial<Omit<WorkflowStage, 'key' | 'ordinal'>>
): WorkflowDraft {
  return {
    ...draft,
    stages: draft.stages.map((stage) => {
      if (stage.key !== key) {
        return stage
      }
      const next = { ...stage, ...patch }
      // A code stage runs a command with no model and no member; the contract rejects one carrying
      // a member, so switching kind clears the field rather than letting the save fail.
      return next.kind === 'code' ? { ...next, memberId: null } : { ...next, codeCommand: null }
    })
  }
}

/**
 * Renames a stage's key and re-points every edge at it.
 *
 * Not cosmetic. SK1 measures a track record under the stage key, so a rename starts a new window:
 * the accumulated evidence stays attached to the old key and the renamed stage begins with none.
 * The canvas warns before calling this; the warning is the point, not the rewrite.
 */
export function renameStageKey(draft: WorkflowDraft, from: string, to: string): WorkflowDraft {
  return {
    ...draft,
    stages: draft.stages.map((stage) => (stage.key === from ? { ...stage, key: to } : stage)),
    transitions: draft.transitions.map((transition) => ({
      ...transition,
      from: transition.from === from ? to : transition.from,
      to: transition.to === from ? to : transition.to
    }))
  }
}

export function addStage(draft: WorkflowDraft, key: string, afterOrdinal?: number): WorkflowDraft {
  const at = afterOrdinal === undefined ? draft.stages.length : afterOrdinal + 1
  const shifted = draft.stages.map((stage) =>
    stage.ordinal >= at ? { ...stage, ordinal: stage.ordinal + 1 } : stage
  )
  return { ...draft, stages: recompact([...shifted, newStage(key, at)]) }
}

/** Removes a stage and every edge touching it — a dangling edge would be invisible on the canvas. */
export function removeStage(draft: WorkflowDraft, key: string): WorkflowDraft {
  return {
    ...draft,
    stages: recompact(draft.stages.filter((stage) => stage.key !== key)),
    transitions: draft.transitions.filter((t) => t.from !== key && t.to !== key)
  }
}

/**
 * Moves a stage one position up or down.
 *
 * Edge kinds are deliberately left alone. A reorder can leave a `correction` edge pointing forward,
 * and re-deriving the kind would silently rewrite something a human authored — `validateDraft`
 * reports it instead, and the human decides.
 */
export function moveStage(draft: WorkflowDraft, key: string, delta: -1 | 1): WorkflowDraft {
  const ordered = [...draft.stages].sort((a, b) => a.ordinal - b.ordinal)
  const index = ordered.findIndex((stage) => stage.key === key)
  const target = index + delta
  if (index === -1 || target < 0 || target >= ordered.length) {
    return draft
  }
  const swapped = [...ordered]
  swapped[index] = ordered[target]!
  swapped[target] = ordered[index]!
  return { ...draft, stages: swapped.map((stage, ordinal) => ({ ...stage, ordinal })) }
}

export function upsertTransition(
  draft: WorkflowDraft,
  transition: WorkflowTransition
): WorkflowDraft {
  const existing = draft.transitions.some(
    (t) => t.from === transition.from && t.to === transition.to
  )
  return {
    ...draft,
    transitions: existing
      ? draft.transitions.map((t) =>
          t.from === transition.from && t.to === transition.to ? transition : t
        )
      : [...draft.transitions, transition]
  }
}

export function removeTransition(draft: WorkflowDraft, from: string, to: string): WorkflowDraft {
  return {
    ...draft,
    transitions: draft.transitions.filter((t) => !(t.from === from && t.to === to))
  }
}

/**
 * A correction edge back to the stage that produced the work — the return path
 * GRAPH-ENGINEERING names, and the reason this canvas exists.
 */
export function correctionTo(from: string, to: string): WorkflowTransition {
  return { from, to, kind: 'correction', trigger: { kind: 'on_failure' } }
}

export function forwardTo(
  from: string,
  to: string,
  trigger: TriggerKind = 'on_success'
): WorkflowTransition {
  return { from, to, kind: 'forward', trigger: { kind: trigger } }
}

/** The kind an edge between these two stages would ordinarily be — a *suggestion* for a new edge. */
export function suggestKind(draft: WorkflowDraft, from: string, to: string): TransitionKind {
  const ordinalOf = (key: string): number =>
    draft.stages.find((stage) => stage.key === key)?.ordinal ?? 0
  return ordinalOf(to) < ordinalOf(from) ? 'correction' : 'forward'
}
