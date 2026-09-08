import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  TRACK_RECORD_WINDOW,
  summarizeTrackRecord,
  type TrackRecord,
  type TrackRecordQuery,
  type TrackRecordVerdict
} from '@alicorn-cloud/control-plane-contract'

type TrackRecordRow = {
  outcome: string
  human_verdict: string | null
  created_at: Date
}

/**
 * The last `TRACK_RECORD_WINDOW` outcomes for one (member, stage, project), newest first.
 *
 * Read from `step_outcomes` rather than `member_stage_stats` because the aggregate is lifetime and
 * §7's thresholds are windowed. `id DESC` breaks a `created_at` tie so the window is deterministic
 * when a batch of outcomes lands in the same millisecond.
 */
export function getTrackRecord(
  pool: pg.Pool,
  tenantId: string,
  key: TrackRecordQuery
): Promise<TrackRecord> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<TrackRecordRow>(
      `SELECT outcome, human_verdict, created_at FROM step_outcomes
       WHERE member_id = $1 AND stage_key = $2 AND project_id = $3
       ORDER BY created_at DESC, id DESC
       LIMIT ${TRACK_RECORD_WINDOW}`,
      [key.memberId, key.stageKey, key.projectId]
    )
    return summarizeTrackRecord(
      key,
      rows.map((row) => ({
        succeeded: row.outcome === 'succeeded',
        humanVerdict: (row.human_verdict as TrackRecordVerdict) ?? null,
        createdAt: row.created_at.toISOString()
      }))
    )
  })
}
