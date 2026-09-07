import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { RuleProposal, RuleProposalInput, RuleProposalStatus } from '@alicorn-cloud/control-plane-contract'

// Why: mirrors MemberInputSchema.systemRules' cap (member.ts) — the append is raw SQL and bypasses
// that zod validation, so this is the only place stopping a member's rules from growing past it.
const MAX_SYSTEM_RULES_LENGTH = 20_000

type RuleProposalRow = {
  id: string
  tenant_id: string
  member_id: string
  outcome_id: string
  verdict: RuleProposal['verdict']
  context: unknown
  proposed_rule: string | null
  status: RuleProposalStatus
  decided_by: string | null
  decided_at: Date | null
  created_at: Date
}

function toRuleProposal(row: RuleProposalRow): RuleProposal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    memberId: row.member_id,
    outcomeId: row.outcome_id,
    verdict: row.verdict,
    context: row.context as RuleProposal['context'],
    proposedRule: row.proposed_rule,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdAt: row.created_at.toISOString()
  }
}

export type CreateResult = { kind: 'ok'; proposal: RuleProposal } | { kind: 'unknown_member' }

export function createRuleProposal(pool: pg.Pool, tenantId: string, input: RuleProposalInput): Promise<CreateResult> {
  return withTenant(pool, tenantId, async (client) => {
    // Why: a foreign key is checked as the system and would happily accept another tenant's member
    // id — this SELECT is RLS-scoped, same guard as workflows-repository's unknownMemberIds.
    const member = await client.query(`SELECT id FROM members WHERE id = $1`, [input.memberId])
    if (member.rows.length === 0) return { kind: 'unknown_member' }
    // Why ON CONFLICT DO UPDATE: the drainer retries this call; DO NOTHING has no RETURNING, so a
    // no-op self-assignment on the conflicting row is what makes the repeat return the same proposal.
    const { rows } = await client.query<RuleProposalRow>(
      `INSERT INTO rule_proposals (tenant_id, member_id, outcome_id, verdict, context)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, outcome_id) DO UPDATE SET outcome_id = EXCLUDED.outcome_id
       RETURNING *`,
      [tenantId, input.memberId, input.outcomeId, input.verdict, JSON.stringify(input.context)]
    )
    return { kind: 'ok', proposal: toRuleProposal(rows[0]!) }
  })
}

export function listRuleProposalsForMember(
  pool: pg.Pool,
  tenantId: string,
  memberId: string,
  status?: RuleProposalStatus
): Promise<RuleProposal[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<RuleProposalRow>(
      `SELECT * FROM rule_proposals WHERE member_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC`,
      [memberId, status ?? null]
    )
    return rows.map(toRuleProposal)
  })
}

export type AcceptResult =
  | { kind: 'ok'; proposal: RuleProposal }
  | { kind: 'not_found' }
  | { kind: 'not_pending'; status: RuleProposalStatus }
  | { kind: 'rules_too_long' }

export function acceptRuleProposal(
  pool: pg.Pool,
  tenantId: string,
  proposalId: string,
  rule: string,
  decidedBy: string
): Promise<AcceptResult> {
  return withTenant(pool, tenantId, async (client) => {
    // Locks the proposal row so a concurrent accept/reject of the *same* proposal serializes
    // instead of both seeing 'pending' and double-appending.
    const current = await client.query<RuleProposalRow>(`SELECT * FROM rule_proposals WHERE id = $1 FOR UPDATE`, [proposalId])
    const proposal = current.rows[0]
    if (!proposal) return { kind: 'not_found' }
    if (proposal.status !== 'pending') return { kind: 'not_pending', status: proposal.status }

    // Why this format: docs/alicorn/plans/2026-09-06-rulebook.md — a marker comment traces a
    // rendered rule back to the proposal that produced it.
    const appended = `\n\n- ${rule}\n<!-- rule:${proposalId} -->`
    // Why one statement: Postgres computes the concatenation and the length guard together, so
    // there is no TypeScript read-modify-write and no lost update between concurrent accepts —
    // two UPDATEs on the same member row serialize and each re-evaluates system_rules || $1 fresh.
    const memberResult = await client.query(
      `UPDATE members SET system_rules = system_rules || $1, updated_at = now()
       WHERE id = $2 AND char_length(system_rules || $1) <= $3`,
      [appended, proposal.member_id, MAX_SYSTEM_RULES_LENGTH]
    )
    if ((memberResult.rowCount ?? 0) === 0) return { kind: 'rules_too_long' }

    const { rows } = await client.query<RuleProposalRow>(
      `UPDATE rule_proposals SET status = 'accepted', proposed_rule = $1, decided_by = $2, decided_at = now()
       WHERE id = $3 RETURNING *`,
      [rule, decidedBy, proposalId]
    )
    return { kind: 'ok', proposal: toRuleProposal(rows[0]!) }
  })
}

export type RejectResult = { kind: 'ok'; proposal: RuleProposal } | { kind: 'not_found' } | { kind: 'not_pending'; status: RuleProposalStatus }

export function rejectRuleProposal(pool: pg.Pool, tenantId: string, proposalId: string, decidedBy: string): Promise<RejectResult> {
  return withTenant(pool, tenantId, async (client) => {
    const current = await client.query<RuleProposalRow>(`SELECT * FROM rule_proposals WHERE id = $1 FOR UPDATE`, [proposalId])
    const proposal = current.rows[0]
    if (!proposal) return { kind: 'not_found' }
    if (proposal.status !== 'pending') return { kind: 'not_pending', status: proposal.status }
    const { rows } = await client.query<RuleProposalRow>(
      `UPDATE rule_proposals SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2 RETURNING *`,
      [decidedBy, proposalId]
    )
    return { kind: 'ok', proposal: toRuleProposal(rows[0]!) }
  })
}
