import { readApprovedTeam } from '../../../alicorn/foreman/composed-team-record'
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
  worktreePath: string
  getGate: (id: string) => DecisionGateRow | undefined | null
  runtime: { getAlicornMemberDirectory: () => MemberDirectory | null }
}): Promise<Pick<PreambleParams, 'foremanRole' | 'runId' | 'approvedTeam' | 'teamRules'>> {
  if (input.role !== 'lead') {
    return {}
  }
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
