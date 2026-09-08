import { z } from 'zod'
import { StageKeySchema } from './workflow.js'

/**
 * The windowed track record a gate reads (ARCHITECTURE §7 *Levels*).
 *
 * Windowed, never lifetime: "a member with 400 good runs must not average its way out of 12 recent
 * bad ones". `member_stage_stats` keeps the lifetime aggregate and is left alone — this is computed
 * from raw `step_outcomes` at read time, which the `step_outcomes_track_record` index exists for.
 */
export const TRACK_RECORD_WINDOW = 50
/** Demotion window: one rejected, or two amended, inside the last ten runs. */
export const TRACK_RECORD_REGRESSION_WINDOW = 10
/** Level 3 additionally requires no amendment inside this many runs. */
export const TRACK_RECORD_CLEAN_WINDOW = 20

/**
 * Demotion is deliberately **asymmetric** to retirement: level 3 costs 50 runs at a 0.95 accept
 * rate with no amendment in 20, and *one* rejection — or two amendments — inside the last ten
 * takes it away. Slow to earn, immediate to lose; do not make the two symmetric.
 */
export const DEMOTION_REASONS = ['rejection', 'amendments'] as const
export type DemotionReason = (typeof DEMOTION_REASONS)[number]

export const TrackRecordQuerySchema = z.object({
  memberId: z.string().trim().min(1).max(200),
  stageKey: StageKeySchema.default('build'),
  projectId: z.string().trim().min(1).max(200)
})
export type TrackRecordQuery = z.infer<typeof TrackRecordQuerySchema>

export const TrackRecordSchema = z.object({
  memberId: z.string(),
  stageKey: z.string(),
  projectId: z.string(),
  /** Outcomes inside the window, newest first. Zero means nothing has been recorded yet. */
  runs: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  amended: z.number().int().nonnegative(),
  acceptRate: z.number().min(0).max(1),
  recentRegression: z.boolean(),
  lastAmendedAt: z.string().nullable(),
  /** Derived at read time and stored nowhere. Descriptive only — no gate retires on it here. */
  level: z.number().int().min(0).max(3),
  /**
   * Has any human verdict at all reached this window? Accept rate is machine-derived, so a stage
   * nobody has ever corrected looks perfect and is not. Caps the level at 1 until it is true.
   */
  amendmentsObserved: z.boolean(),
  /** Rejections inside the demotion window — one is enough to demote. */
  recentRejected: z.number().int().nonnegative(),
  /** Amendments inside the demotion window — two are enough to demote. */
  recentAmended: z.number().int().nonnegative(),
  /**
   * Why the stage was demoted, or null when it was not. Descriptive: `recentRegression` is what
   * the policy acts on, and this says which of its two halves fired, so a human reading a gate
   * that came back is told whether it was a rejection or a run of amendments.
   */
  demotionReason: z.enum(DEMOTION_REASONS).nullable()
})
export type TrackRecord = z.infer<typeof TrackRecordSchema>

export type TrackRecordVerdict = 'accepted' | 'rejected' | 'amended' | null
/** One outcome inside the window, newest first. */
export type TrackRecordOutcome = {
  succeeded: boolean
  humanVerdict: TrackRecordVerdict
  createdAt: string
}

/**
 * ARCHITECTURE §7's level table, as a pure function over the window.
 *
 * Entry conditions are absolute run counts, not the policy's `minRuns`/`minAcceptRate`: those two
 * are the *gate* thresholds a project authors, and letting a project author its own level entry
 * would be a member loosening its own criteria one indirection removed.
 */
export function computeAutonomyLevel(stats: {
  runs: number
  acceptRate: number
  recentRegression: boolean
  amendmentsObserved: boolean
  amendedInCleanWindow: boolean
}): 0 | 1 | 2 | 3 {
  let level: 0 | 1 | 2 | 3 = 0
  if (stats.runs >= 10) level = 1
  if (stats.runs >= 20 && stats.acceptRate >= 0.9) level = 2
  if (stats.runs >= 50 && stats.acceptRate >= 0.95 && !stats.amendedInCleanWindow) level = 3
  // A regression drops one level immediately and the full entry condition must be met again.
  if (stats.recentRegression && level > 0) level = (level - 1) as 0 | 1 | 2
  // Nothing has ever been corrected here, so the accept rate is unproven. Advisory at most.
  if (!stats.amendmentsObserved && level > 1) level = 1
  return level
}

/** Folds the window into the record. Separated from the query so the arithmetic is testable. */
export function summarizeTrackRecord(
  key: TrackRecordQuery,
  window: readonly TrackRecordOutcome[]
): TrackRecord {
  const runs = window.length
  const rejected = window.filter((row) => row.humanVerdict === 'rejected').length
  const amended = window.filter((row) => row.humanVerdict === 'amended').length
  // A human verdict overrides what the agent reported about itself.
  const accepted = window.filter(
    (row) => row.succeeded && row.humanVerdict !== 'rejected' && row.humanVerdict !== 'amended'
  ).length
  const recent = window.slice(0, TRACK_RECORD_REGRESSION_WINDOW)
  const recentRejected = recent.filter((row) => row.humanVerdict === 'rejected').length
  const recentAmended = recent.filter((row) => row.humanVerdict === 'amended').length
  // One rejection, or two amendments, inside the last ten. See DEMOTION_REASONS.
  const demotionReason: DemotionReason | null =
    recentRejected >= 1 ? 'rejection' : recentAmended >= 2 ? 'amendments' : null
  const recentRegression = demotionReason !== null
  const amendmentsObserved = window.some((row) => row.humanVerdict !== null)
  const amendedInCleanWindow = window
    .slice(0, TRACK_RECORD_CLEAN_WINDOW)
    .some((row) => row.humanVerdict === 'amended')
  const acceptRate = runs === 0 ? 0 : accepted / runs

  return TrackRecordSchema.parse({
    memberId: key.memberId,
    stageKey: key.stageKey,
    projectId: key.projectId,
    runs,
    accepted,
    rejected,
    amended,
    acceptRate,
    recentRegression,
    lastAmendedAt: window.find((row) => row.humanVerdict === 'amended')?.createdAt ?? null,
    level: computeAutonomyLevel({
      runs,
      acceptRate,
      recentRegression,
      amendmentsObserved,
      amendedInCleanWindow
    }),
    amendmentsObserved,
    recentRejected,
    recentAmended,
    demotionReason
  })
}
