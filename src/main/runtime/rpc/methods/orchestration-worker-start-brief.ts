import { readApprovedTeam } from '../../../alicorn/foreman/composed-team-record'
import { seedRunJournal } from '../../../alicorn/foreman/run-journal-seed'
import { readTeamRulesForLead } from './orchestration-member-worker-start'
import { buildDispatchPreamble, type PreambleParams } from '../../orchestration/preamble'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import type { DecisionGateRow, DispatchContextRow, RunRow, TaskRow } from '../../orchestration/types'

/**
 * The whole brief a worker start sends: the fields every dispatch carries, the member's own
 * accepted rules (RB1 Task 4), and the lead-only fields below.
 *
 * Assembled here rather than inline at the call site because the two Alicorn additions to a brief
 * — a member's rules and a lead's journal/roster/team rules — are one concern, and the worker-start
 * flow should gain a call rather than a second preamble literal to keep in step with this one.
 */
export async function buildWorkerStartPreamble(input: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  task: TaskRow
  params: WorkerStartInput
  dispatch: DispatchContextRow
  worktree: { path: string; hostId?: string | null }
  terminalHandle: string
  dispatchCapability: string
  /** Empty for a direct launch, which is what keeps a memberless dispatch paying nothing. */
  memberRules: string
}): Promise<string> {
  const { runtime, db, run, task, params, dispatch, terminalHandle } = input
  const lead = await leadBriefPreambleFields({
    role: params.role,
    runId: run.id,
    objective: run.objective,
    worktreePath: input.worktree.path,
    worktreeHostId: input.worktree.hostId ?? null,
    getGate: (id) => db.getGate(id),
    runtime
  })
  return buildDispatchPreamble({
    canDispatchSubWorkers: dispatch.depth < runtime.getNestedWorkerMaxDepth(),
    taskId: task.id,
    dispatchId: dispatch.id,
    taskSpec: task.spec,
    coordinatorHandle: params.from,
    workerHandle: terminalHandle,
    dispatchCapability: input.dispatchCapability,
    devMode: params.devMode,
    cliCommand: runtime.getTerminalOrchestrationCliCommand(terminalHandle),
    memberRules: input.memberRules,
    ...lead
  })
}

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
