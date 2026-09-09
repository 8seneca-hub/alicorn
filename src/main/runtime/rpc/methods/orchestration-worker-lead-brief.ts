import { readApprovedTeam } from '../../../alicorn/foreman/composed-team-record'
import { seedRunJournal } from '../../../alicorn/foreman/run-journal-seed'
import { readTeamRulesForLead } from './orchestration-member-worker-start'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { PreambleParams } from '../../orchestration/preamble'
import type { DecisionGateRow } from '../../orchestration/types'

/**
 * The preamble fields only a Foreman lead gets: its journal, the roster a human approved for the
 * run (AT1), and the standing rules of the members it may dispatch (RB2).
 *
 * Empty for every other dispatch, which is what keeps `single` the default path — an ordinary
 * worker start reads no journal and takes no extra disk hit. Both fields come off disk, so they are
 * resolved here rather than inside `buildDispatchPreamble`, which stays a pure string builder.
 */
export async function leadBriefPreambleFields(input: {
  role: 'worker' | 'lead' | undefined
  runId: string
  objective: string
  worktreePath: string
  worktreeHostId?: string | null
  getGate: (id: string) => DecisionGateRow | undefined | null
  runtime: { getAlicornMemberDirectory: () => MemberDirectory | null }
}): Promise<Pick<PreambleParams, 'foremanRole' | 'runId' | 'approvedTeam' | 'teamRules'>> {
  if (input.role !== 'lead') {
    return {}
  }
  // FJ1: dispatching the lead *is* run start here — the coordinator that used to open the journal
  // sits behind a retired RPC and never reaches a running app. Before the brief, so the file the
  // lead is told to work from exists by the time it reads the brief.
  await seedRunJournal({
    worktree: { path: input.worktreePath, hostId: input.worktreeHostId ?? null },
    runId: input.runId,
    objective: input.objective
  })
  return {
    foremanRole: 'lead',
    runId: input.runId,
    approvedTeam: await readApprovedTeam({
      worktreePath: input.worktreePath,
      runId: input.runId,
      getGate: input.getGate
    }),
    teamRules: await readTeamRulesForLead(input.runtime)
  }
}
