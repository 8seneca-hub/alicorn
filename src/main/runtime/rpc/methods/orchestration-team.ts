import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'
import { resolveRunScope } from './orchestration-run-scope'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { getLatestDispatchForTask } from '../../orchestration/db/dispatch-context/task-dispatch-reconciliation'
import { proposeTeam } from '../../../alicorn/foreman/team-proposal-source'
import { renderTeamGateQuestion, TEAM_GATE_OPTIONS } from '../../../alicorn/foreman/team-composer'
import { journalComposedTeam } from '../../../alicorn/foreman/composed-team-record'
import type { OrchestrationDb } from '../../orchestration/db'

/** Only the worktree fields a proposal needs — the project to rank in, the disk to journal on. */
export type TeamWorktree = {
  id: string
  path: string
  repoId?: string
  projectId?: string
  hostId?: string | null
}

type TeamWorktreeResolver = {
  showManagedWorktree: (selector: string) => Promise<TeamWorktree>
}

const TeamProposeParams = z.object({
  task: requiredString('Missing --task'),
  /** Names the workspace the team will work in. Falls back to the task's latest dispatch. */
  worktree: OptionalString,
  /** What the team is for. Falls back to the run's objective. */
  goal: OptionalString,
  from: OptionalString,
  run: OptionalString
})

export const ORCHESTRATION_TEAM_METHODS: RpcMethod[] = [
  /**
   * AT1 — compose a team from member roles and put it to a human.
   *
   * The composition is never applied here: taking the answer *is* opening the gate that asks about
   * it, so there is no "who would you pick?" read a caller could take and then act on alone. Same
   * shape as `gateCreate { evaluate }`, and for the same reason.
   */
  defineMethod({
    name: 'orchestration.teamPropose',
    params: TeamProposeParams,
    handler: async (
      params,
      { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const task = db.getTask(params.task)
      if (!task) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      if (task.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.task} was not found in Run ${run.id}.`
        )
      }
      const directory = runtime.getAlicornMemberDirectory()
      if (!directory) {
        throw new OrchestrationError(
          'control_plane_unconfigured',
          'A team is composed from the organisation members, and no control plane is configured to read them from.'
        )
      }

      const worktree = await resolveTeamWorktree(db, runtime, params.task, params.worktree)
      const team = await proposeTeam({
        directory,
        projectId: worktree?.projectId ?? worktree?.repoId ?? null,
        goal: params.goal ?? run.objective
      })

      // The gate opens before the journal is written, so the id the journal records is the id a
      // human will resolve. A gate that could not be journalled still gates; a journal entry for a
      // gate that was never opened would be a roster nobody can approve.
      const gate = db.createGate({
        taskId: params.task,
        question: renderTeamGateQuestion(team),
        options: [...TEAM_GATE_OPTIONS]
      })
      const journalled = await journalComposedTeam({
        worktree,
        runId: run.id,
        objective: run.objective,
        team,
        gateId: gate.id
      })
      return { gate, team, journalled }
    }
  })
]

/**
 * The workspace the team would work in: named by the caller, or the one the task last ran in.
 *
 * Null is a real answer — a task that has never been dispatched and a caller who named no worktree
 * leave nothing to resolve — and it costs the ranking and the journal, not the proposal.
 */
async function resolveTeamWorktree(
  db: OrchestrationDb,
  runtime: TeamWorktreeResolver,
  taskId: string,
  selector: string | undefined
): Promise<TeamWorktree | null> {
  const dispatch = getLatestDispatchForTask(db, taskId)
  const worktreeId = dispatch ? (db.getWorkerDispatch(dispatch.id)?.worktree_id ?? null) : null
  const target = selector ?? (worktreeId ? `id:${worktreeId}` : null)
  if (!target) {
    return null
  }
  try {
    return await runtime.showManagedWorktree(target)
  } catch {
    return null
  }
}
