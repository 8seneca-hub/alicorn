import { evaluateReviewBackend } from '../review-backend-policy'
import type { Member, MemberBackend } from '../../../shared/alicorn/members'
import type { FEATURE_DELIVERY_STAGE_KEYS } from '../../../shared/alicorn/stage-keys'

type FeatureDeliveryStageKey = (typeof FEATURE_DELIVERY_STAGE_KEYS)[number]

/**
 * AT1 — a team an agent composes and a human approves.
 *
 * The composition is a *proposal*, never an application: it is written to the Feature Journal and
 * put behind a decision gate, and the lead only ever sees a roster a human accepted (CLAUDE.md,
 * sequencing rule 1 — automatic composition without a gate waits for evidence that does not exist
 * yet).
 *
 * Nothing here relaxes anything. A proposal grants no exemption: `resolveWorkerMemberLaunch` still
 * enforces the reviewer's backend and QA's blindfold at launch, and required checks are still
 * authored on the stage. A composed team that could waive either would be exactly the loophole
 * ARCHITECTURE forbids — so the composer's only power is to *decline* to propose one.
 */

/** The seats a delivery team fills. Not `MemberRole`: `analyst` and `other` are not seats. */
export const TEAM_SEAT_ROLES = ['developer', 'reviewer', 'qa'] as const
export type TeamSeatRole = (typeof TEAM_SEAT_ROLES)[number]

/**
 * SK1: an accept rate only means something inside one authored stage, so each seat names the stage
 * its candidates are ranked under. Ranking a reviewer on its `build` window would compare a member
 * to work it never did.
 *
 * Typed against `FEATURE_DELIVERY_STAGE_KEYS` rather than `string`, so renaming a stage in the
 * shipped template fails the build here instead of silently ranking every seat on an empty window.
 */
export const TEAM_SEAT_STAGE_KEYS: Readonly<Record<TeamSeatRole, FeatureDeliveryStageKey>> = {
  developer: 'build',
  reviewer: 'review',
  qa: 'verify'
}

/** One member's window at one stage, as the Ledger API serves it. Absent means "not measured". */
export type SeatTrackRecord = {
  memberId: string
  stageKey: string
  acceptRate: number
  runs: number
}

export type TeamSeat = {
  role: TeamSeatRole
  stageKey: string
  memberId: string | null
  memberName: string | null
  backend: MemberBackend | null
  /** Null when the seat is empty *or* when the member has no measured window at this stage. */
  acceptRate: number | null
  runs: number | null
  /** The line the human at the gate reads. A seat nobody can explain is not a seat worth accepting. */
  why: string
}

export type ComposedTeam = {
  goal: string
  seats: TeamSeat[]
  /** Why the team is incomplete. Empty means every seat is filled. */
  gaps: string[]
}

/**
 * A composed team as the Feature Journal records it: the roster, plus the gate that asks about it.
 *
 * The *verdict* is deliberately absent. `decision_gates.resolution` is already the durable record
 * of a human decision — GP3 writes gate agreement against the same row — and a second copy here
 * would be a second answer to one question, free to drift from the first.
 */
export type JournalTeam = ComposedTeam & { gateId: string }

export type ComposeTeamInput = {
  /** What the team is for — recorded so the roster is judged against something. */
  goal: string
  members: readonly Member[]
  trackRecords: readonly SeatTrackRecord[]
}

/**
 * Picks one member per seat, preferring the highest accept rate in that seat's stage window.
 *
 * Seats are filled in order because the reviewer's eligibility depends on the developer's backend.
 * Members hold exactly one `role`, so no member can be proposed for two seats and no exclusion set
 * is needed.
 */
export function composeTeam(input: ComposeTeamInput): ComposedTeam {
  const gaps: string[] = []
  const seats: TeamSeat[] = []
  let developerBackend: MemberBackend | null = null

  for (const role of TEAM_SEAT_ROLES) {
    const stageKey = TEAM_SEAT_STAGE_KEYS[role]
    const byRole = input.members.filter((member) => member.role === role)
    const eligible =
      role === 'reviewer' ? byRole.filter((m) => reviewerAllowed(m, developerBackend)) : byRole

    const ranked = [...eligible].sort((a, b) =>
      compareCandidates(
        { member: a, record: windowFor(input.trackRecords, a.id, stageKey) },
        { member: b, record: windowFor(input.trackRecords, b.id, stageKey) }
      )
    )
    const chosen = ranked[0]
    if (!chosen) {
      const gap = describeGap(role, byRole.length, developerBackend)
      gaps.push(gap)
      seats.push(emptySeat(role, stageKey, gap))
      continue
    }

    if (role === 'developer') {
      developerBackend = chosen.backend
    }
    const record = windowFor(input.trackRecords, chosen.id, stageKey)
    seats.push({
      role,
      stageKey,
      memberId: chosen.id,
      memberName: chosen.name,
      backend: chosen.backend,
      // `measuredRate`, not the raw field: a zero-run window is unmeasured, and reporting it as 0%
      // beside a `why` that says "no measured runs" would show the human two different facts.
      acceptRate: measuredRate(record),
      runs: record?.runs ?? null,
      why: describeChoice({ role, stageKey, record, candidates: ranked.length, developerBackend })
    })
  }

  return { goal: input.goal, seats, gaps }
}

/** True when this reviewer could actually be launched — the same rule the launch path enforces. */
function reviewerAllowed(reviewer: Member, developerBackend: MemberBackend | null): boolean {
  if (developerBackend === null) {
    return true
  }
  // Deliberately always `enforce: true`, whatever the org policy says. The opt-out exists so a
  // human can knowingly bypass; a proposal that quietly seats a same-backend reviewer would spend
  // that bypass on the human's behalf, which is the one thing a composed team must never do.
  return evaluateReviewBackend({
    reviewerBackend: reviewer.backend,
    authorBackends: new Set([developerBackend]),
    enforce: true,
    bypassRequested: false
  }).allowed
}

/**
 * Rank: measured accept rate first, then the larger window, then id for determinism.
 *
 * A member with zero runs is *unmeasured*, not bad — an accept rate over no runs is not 0, it is
 * unknown — so it sorts with the unproven rather than below a member with a poor record.
 */
function compareCandidates(
  a: { member: Member; record: SeatTrackRecord | null },
  b: { member: Member; record: SeatTrackRecord | null }
): number {
  const rateA = measuredRate(a.record)
  const rateB = measuredRate(b.record)
  if (rateA !== rateB) {
    if (rateA === null) {
      return 1
    }
    if (rateB === null) {
      return -1
    }
    return rateB - rateA
  }
  const runsDelta = (b.record?.runs ?? 0) - (a.record?.runs ?? 0)
  return runsDelta !== 0 ? runsDelta : a.member.id.localeCompare(b.member.id)
}

function measuredRate(record: SeatTrackRecord | null): number | null {
  return record && record.runs > 0 ? record.acceptRate : null
}

function windowFor(
  records: readonly SeatTrackRecord[],
  memberId: string,
  stageKey: string
): SeatTrackRecord | null {
  return records.find((r) => r.memberId === memberId && r.stageKey === stageKey) ?? null
}

function emptySeat(role: TeamSeatRole, stageKey: string, why: string): TeamSeat {
  return {
    role,
    stageKey,
    memberId: null,
    memberName: null,
    backend: null,
    acceptRate: null,
    runs: null,
    why
  }
}

function describeGap(
  role: TeamSeatRole,
  membersInRole: number,
  developerBackend: MemberBackend | null
): string {
  if (membersInRole === 0) {
    return `No ${role} member exists in this organisation — add one, or run this stage yourself.`
  }
  return `Every reviewer runs on ${developerBackend}, the proposed developer's backend. Add a reviewer on another backend, or dispatch the review with --allow-same-backend-review to record a bypass.`
}

function describeChoice(input: {
  role: TeamSeatRole
  stageKey: string
  record: SeatTrackRecord | null
  candidates: number
  developerBackend: MemberBackend | null
}): string {
  const distinct =
    input.role === 'reviewer' && input.developerBackend
      ? ` Not on the developer's backend (${input.developerBackend}).`
      : ''
  const rate = measuredRate(input.record)
  if (rate === null) {
    return `No measured runs at "${input.stageKey}" yet — proposed on role alone.${distinct}`
  }
  const evidence = `${Math.round(rate * 100)}% accepted over ${input.record?.runs} run(s) at "${input.stageKey}"`
  // "candidates" rather than pluralising the role, because "2 qas" reads like a typo at a gate.
  return input.candidates === 1
    ? `Only ${input.role} candidate; ${evidence}.${distinct}`
    : `Best of ${input.candidates} ${input.role} candidates: ${evidence}.${distinct}`
}

/**
 * What the human is asked. The roster is in the question itself, not only in the journal: a gate
 * whose question is "Run with this team?" and whose team is in another file is a rubber stamp.
 */
export function renderTeamGateQuestion(team: ComposedTeam): string {
  const lines = [
    'Run with this team?',
    '',
    team.goal ? `Goal: ${team.goal}` : 'Goal: (not stated)',
    ''
  ]
  for (const seat of team.seats) {
    const who = seat.memberName
      ? `${seat.memberName} (${seat.backend}, ${seat.memberId})`
      : '— unfilled'
    lines.push(`${seat.role} @ ${seat.stageKey}: ${who}`, `  ${seat.why}`)
  }
  if (team.gaps.length > 0) {
    lines.push('', 'Accepting leaves these open:')
    for (const gap of team.gaps) {
      lines.push(`  - ${gap}`)
    }
  }
  return lines.join('\n')
}

export const TEAM_GATE_OPTIONS = ['accept', 'reject'] as const

/**
 * Only the exact accept option counts. A resolution the human typed themselves — "yes but swap the
 * reviewer" — is a conversation, not an approval, and the lead runs without a composed team rather
 * than with a guess at one.
 */
export function isTeamAccepted(resolution: string | null): boolean {
  return resolution !== null && resolution.trim().toLowerCase() === TEAM_GATE_OPTIONS[0]
}
