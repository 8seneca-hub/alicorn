import {
  composeTeam,
  TEAM_SEAT_ROLES,
  TEAM_SEAT_STAGE_KEYS,
  type ComposedTeam,
  type SeatTrackRecord,
  type TeamSeatRole
} from './team-composer'
import type { MemberDirectory } from '../member-directory'
import type { Member } from '../../../shared/alicorn/members'

/** Only what a proposal reads. Keeps the composer off the full directory surface. */
export type TeamProposalDirectory = Pick<MemberDirectory, 'listMembers' | 'getTrackRecord'>

/**
 * Reads the candidate pool and its windows, then composes.
 *
 * Split from `composeTeam` so the ranking stays a pure function: the reads are the part that can be
 * unavailable, and every way they can be unavailable has to degrade to *less evidence*, never to a
 * different team than the evidence supports.
 */
export async function proposeTeam(input: {
  directory: TeamProposalDirectory
  /** Null when no project could be resolved — the composition then has no windows to rank on. */
  projectId: string | null
  goal: string
}): Promise<ComposedTeam> {
  // Deliberately not caught: with no member list there is no team to propose, and a proposal built
  // from an empty pool would read as "this organisation has nobody" rather than "we could not ask".
  const members = await input.directory.listMembers()
  const trackRecords = input.projectId
    ? await readSeatWindows(input.directory, input.projectId, members)
    : []
  const team = composeTeam({ goal: input.goal, members, trackRecords })
  if (!input.projectId) {
    team.gaps.push(
      'No project could be resolved for this task, so nobody was ranked on their track record — this roster is role coverage only. Pass --worktree to name the workspace and rank on accepted work.'
    )
  }
  return team
}

function seatRoleOf(member: Member): TeamSeatRole | null {
  return TEAM_SEAT_ROLES.find((role) => role === member.role) ?? null
}

/**
 * One window per candidate, at the stage its own seat is measured under.
 *
 * A window that cannot be read is dropped rather than defaulted: `composeTeam` already treats an
 * absent record as unmeasured and says so on the seat, so a ledger outage costs the ranking and is
 * visible to the human at the gate, instead of quietly reading as a zero accept rate.
 */
async function readSeatWindows(
  directory: TeamProposalDirectory,
  projectId: string,
  members: readonly Member[]
): Promise<SeatTrackRecord[]> {
  const reads = members.flatMap((member) => {
    const role = seatRoleOf(member)
    if (!role) {
      return []
    }
    const stageKey: string = TEAM_SEAT_STAGE_KEYS[role]
    return [
      directory
        .getTrackRecord({ projectId, stageKey, memberId: member.id })
        .then((record) => ({
          memberId: member.id,
          stageKey,
          acceptRate: record.acceptRate,
          runs: record.runs
        }))
        .catch(() => null)
    ]
  })
  return (await Promise.all(reads)).filter((record): record is SeatTrackRecord => record !== null)
}
