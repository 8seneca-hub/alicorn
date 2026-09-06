import type pg from 'pg'

export type MemberStageStatsInput = {
  tenantId: string
  memberId: string
  stageKey: string
  projectId: string
  accepted: boolean
}

// Why: derived accept-rate track record, upserted in the same transaction as the
// step_outcomes insert that produced it so the two never drift apart.
export async function upsertMemberStageStats(client: pg.PoolClient, input: MemberStageStatsInput): Promise<void> {
  const accepted = input.accepted ? 1 : 0
  // Why: `accepted` is bound as two separate params ($5, $6) even though both carry the same
  // value — one placeholder shared between the integer `accepted` and numeric `accept_rate`
  // columns makes node-pg's extended query protocol fail with "inconsistent types deduced for
  // parameter" (int vs numeric).
  await client.query(
    `INSERT INTO member_stage_stats (tenant_id, member_id, stage_key, project_id, runs, accepted, accept_rate)
     VALUES ($1, $2, $3, $4, 1, $5, $6)
     ON CONFLICT (tenant_id, member_id, stage_key, project_id) DO UPDATE SET
       runs = member_stage_stats.runs + 1,
       accepted = member_stage_stats.accepted + EXCLUDED.accepted,
       accept_rate = (member_stage_stats.accepted + EXCLUDED.accepted)::numeric / (member_stage_stats.runs + 1),
       updated_at = now()`,
    [input.tenantId, input.memberId, input.stageKey, input.projectId, accepted, accepted]
  )
}
