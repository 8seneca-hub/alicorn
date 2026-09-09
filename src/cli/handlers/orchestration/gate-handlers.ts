import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalJsonFlag, getOptionalStringFlag, getRequiredStringFlag } from '../../flags'
import { callOrchestrationMutation } from './mutation-request'
import { resolveCoordinatorTerminalHandle } from './terminal-identity'

export const ORCHESTRATION_GATE_HANDLERS: Record<string, CommandHandler> = {
  'orchestration gate-create': async ({ flags, client, cwd, json }) => {
    const result = await callOrchestrationMutation<{
      gate: { id: string; task_id: string; status: string }
      recommendation?: { decision: string; reason: string }
    }>(client, flags, 'orchestration.gateCreate', {
      task: getRequiredStringFlag(flags, 'task'),
      question: getRequiredStringFlag(flags, 'question'),
      options: getOptionalJsonFlag(flags, 'options'),
      evaluate: flags.has('evaluate') ? true : undefined,
      stageKey: getOptionalStringFlag(flags, 'stage-key'),
      // Why: gates are Run-scoped, so the coordinator handle is the authorized caller identity.
      from: await resolveCoordinatorTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, (value) => {
      const created = `Gate ${value.gate.id} created for task ${value.gate.task_id} [${value.gate.status}]`
      if (!value.recommendation) {
        return created
      }
      return `${created}\nPolicy would ${value.recommendation.decision} (${value.recommendation.reason})`
    })
  },

  // AT1: composing a team is the same act as opening the gate that asks about it, so there is one
  // verb and it always leaves a gate behind.
  'orchestration team-propose': async ({ flags, client, cwd, json }) => {
    const result = await callOrchestrationMutation<{
      gate: { id: string; task_id: string; status: string }
      team: {
        seats: { role: string; memberName: string | null; backend: string | null; why: string }[]
        gaps: string[]
      }
      journalled: boolean
    }>(client, flags, 'orchestration.teamPropose', {
      task: getRequiredStringFlag(flags, 'task'),
      worktree: getOptionalStringFlag(flags, 'worktree'),
      goal: getOptionalStringFlag(flags, 'goal'),
      from: await resolveCoordinatorTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, (value) => {
      const roster = value.team.seats.map(
        (seat) =>
          `  ${seat.role}: ${seat.memberName ?? '— unfilled'}${seat.backend ? ` (${seat.backend})` : ''}\n    ${seat.why}`
      )
      const gaps = value.team.gaps.map((gap) => `  - ${gap}`)
      return [
        `Gate ${value.gate.id} asks task ${value.gate.task_id} to approve this team [${value.gate.status}]`,
        ...roster,
        ...(gaps.length > 0 ? ['Gaps:', ...gaps] : []),
        value.journalled
          ? 'Recorded in the Feature Journal; resolve the gate with --resolution accept to brief the lead with it.'
          : 'Not recorded in the Feature Journal — the lead will not be briefed with this roster.'
      ].join('\n')
    })
  },

  'orchestration verify-record': async ({ flags, client, cwd, json }) => {
    const result = await callOrchestrationMutation<{
      taskId: string
      dispatchId: string
      verifications: { name: string; status: string }[]
    }>(client, flags, 'orchestration.verifyRecord', {
      task: getRequiredStringFlag(flags, 'task'),
      name: getRequiredStringFlag(flags, 'name'),
      status: getRequiredStringFlag(flags, 'status'),
      kind: getOptionalStringFlag(flags, 'kind'),
      dispatch: getOptionalStringFlag(flags, 'dispatch'),
      // Why an --optional opt-out rather than a --required opt-in: a check nobody classified is
      // one the gate must see.
      required: flags.has('optional') ? false : undefined,
      detail: getOptionalJsonFlag(flags, 'detail'),
      from: await resolveCoordinatorTerminalHandle(flags, cwd, client)
    })
    printResult(
      result,
      json,
      (value) =>
        `Recorded ${value.verifications.length} check(s) for task ${value.taskId} on dispatch ${value.dispatchId}`
    )
  },

  'orchestration gate-resolve': async ({ flags, client, cwd, json }) => {
    const result = await callOrchestrationMutation<{
      gate: { id: string; task_id: string; status: string; resolution: string }
    }>(client, flags, 'orchestration.gateResolve', {
      id: getRequiredStringFlag(flags, 'id'),
      resolution: getRequiredStringFlag(flags, 'resolution'),
      from: await resolveCoordinatorTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, (value) => `Gate ${value.gate.id} resolved: ${value.gate.resolution}`)
  },

  'orchestration gate-list': async ({ flags, client, cwd, json }) => {
    const run = getOptionalStringFlag(flags, 'run')
    // Why: named runs remain inspectable without a pane; only implicit runs resolve identity.
    const from = run ? undefined : await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await client.call<{
      gates: { id: string; task_id: string; question: string; status: string }[]
      count: number
      runId?: string
    }>('orchestration.gateList', {
      task: getOptionalStringFlag(flags, 'task'),
      status: getOptionalStringFlag(flags, 'status'),
      run,
      from
    })
    printResult(result, json, (value) => {
      if (value.gates.length === 0) {
        return 'No gates found.'
      }
      return value.gates
        .map((gate) => `${gate.id} task=${gate.task_id} [${gate.status}] "${gate.question}"`)
        .join('\n')
    })
  }
}
