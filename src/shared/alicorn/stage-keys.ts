// Hand-mirrored from cloud/packages/control-plane-contract/src/workflow-template.ts
// (`FEATURE_DELIVERY_TEMPLATE`). Keys and column bindings must stay identical — the desktop does
// not import the contract package, so a rename there is a silent break here.

/**
 * The stage keys a window may be measured under (SK1).
 *
 * A track record is only evidence if every run in it was measured under the *same* stage, and a
 * key typed by the member being judged cannot guarantee that: `--phase reveiw` and `--phase review`
 * are two windows for one stage, and neither is comparable to anything. So keys come from authored
 * config — a workflow template, or the board column that dispatched the work — and free text is
 * kept for forensics but never treated as authored. See `resolveStageKey`.
 */
export const FEATURE_DELIVERY_STAGE_KEYS = [
  'spec',
  'architecture',
  'design',
  'build',
  'review',
  'verify',
  'merge',
  'deploy'
] as const

/**
 * Board column id (`WorkspaceStatus.id`) → the template stage it dispatches
 * (`WorkflowTemplateStage.columnId`). Without this a board dispatch to *In progress* and a worker
 * reporting `--phase build` accumulate two half-windows for one stage.
 */
export const TEMPLATE_STAGE_KEY_BY_COLUMN_ID: Readonly<Record<string, string>> = {
  todo: 'spec',
  'in-progress': 'build',
  'in-review': 'review',
  completed: 'merge'
}

/** Applied when nothing named a stage at all. A template key, so it is authored. */
export const DEFAULT_STAGE_KEY = 'build'

/**
 * The *narrower* of the two bounds on the wire: `step_outcomes.stageKey` accepts 64 characters but
 * `StageKeySchema` — which the track-record query uses — is `^[a-z0-9][a-z0-9_-]{0,62}$`, so a
 * 64-character key could be written and then never read back as a window.
 */
export const STAGE_KEY_MAX_LENGTH = 63

/** Where the resolved key came from. `reported` is the only one the measured member chose. */
export type StageKeySource = 'board' | 'template' | 'reported' | 'default'

export type ResolvedStageKey = {
  stageKey: string
  source: StageKeySource
  /**
   * True when the key names an authored stage. Only an authored key may retire a gate — a window
   * keyed on free text is recorded, and measured, but never earns autonomy.
   */
  authored: boolean
}

/**
 * Folds free text into the shape `StageKeySchema` accepts: lowercase, `-` separated, no leading or
 * trailing separator. Returns null for anything that normalizes away, which reads as "no key was
 * reported" rather than as an empty one.
 */
export function normalizeStageKey(raw: string | null | undefined): string | null {
  if (!raw) {
    return null
  }
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, STAGE_KEY_MAX_LENGTH)
    .replace(/-+$/, '')
  return slug.length > 0 ? slug : null
}

export function isAuthoredStageKey(
  stageKey: string,
  authoredStageKeys: readonly string[] = FEATURE_DELIVERY_STAGE_KEYS
): boolean {
  return authoredStageKeys.includes(stageKey)
}

/**
 * Resolves the stage a step is measured under, in the precedence ARCHITECTURE §3 fixed and SK1
 * extends: the **board column wins over the worker's own `--phase`**, because the stage a member is
 * judged on is authored config, never something the member being judged chooses for itself.
 *
 * What SK1 adds on top of that precedence is the mapping to template keys. Both a column id and a
 * reported phase are looked up against the authored set first, so `in-progress` and `Build` both
 * land on `build`; only text that matches nothing survives as itself, with `authored: false`.
 *
 * Nothing is discarded. An unrecognised phase is still recorded and still measured — it simply
 * cannot retire a gate, which is the difference between keeping data and trusting it.
 */
export function resolveStageKey(input: {
  boardColumnId?: string | null
  reportedPhase?: string | null
  /** The project's authored stage keys. Defaults to the template that ships in this release. */
  authoredStageKeys?: readonly string[]
}): ResolvedStageKey {
  const authoredStageKeys = input.authoredStageKeys ?? FEATURE_DELIVERY_STAGE_KEYS

  const column = normalizeStageKey(input.boardColumnId)
  if (column !== null) {
    return { ...matchAuthored(column, authoredStageKeys), source: 'board' }
  }

  const phase = normalizeStageKey(input.reportedPhase)
  if (phase !== null) {
    const matched = matchAuthored(phase, authoredStageKeys)
    return { ...matched, source: matched.authored ? 'template' : 'reported' }
  }

  return { stageKey: DEFAULT_STAGE_KEY, source: 'default', authored: true }
}

function matchAuthored(
  key: string,
  authoredStageKeys: readonly string[]
): { stageKey: string; authored: boolean } {
  if (isAuthoredStageKey(key, authoredStageKeys)) {
    return { stageKey: key, authored: true }
  }
  const mapped = TEMPLATE_STAGE_KEY_BY_COLUMN_ID[key]
  if (mapped !== undefined && isAuthoredStageKey(mapped, authoredStageKeys)) {
    return { stageKey: mapped, authored: true }
  }
  return { stageKey: key, authored: false }
}
