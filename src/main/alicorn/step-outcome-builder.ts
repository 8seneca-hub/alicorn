import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { StepOutcomeInput } from '../../shared/alicorn/ledger-inputs'
import type { StepOutcomeBackend } from '../../shared/alicorn/ledger'
import { tuiAgentToAgentKind } from '../../shared/agent-kind'
import type { TuiAgent } from '../../shared/tui-agent'

const REPORT_SUMMARY_MAX_CHARS = 4000

// Agents Alicorn prices/polices; every other launchable agent (or a stale/unparseable
// start_options) reports as 'other'.
const BACKEND_BY_AGENT_KIND: Partial<Record<string, StepOutcomeBackend>> = {
  'claude-code': 'claude',
  codex: 'codex',
  grok: 'grok',
  openclaude: 'openclaude'
}

// Exported so other Alicorn features (e.g. run-cost-publisher) reuse this exact
// start_options.agent resolution instead of duplicating BACKEND_BY_AGENT_KIND.
export function backendFromWorkerStartOptions(
  startOptions: string | undefined
): StepOutcomeBackend {
  if (!startOptions) {
    return 'other'
  }
  try {
    const parsed = JSON.parse(startOptions) as { agent?: unknown }
    if (typeof parsed.agent !== 'string') {
      return 'other'
    }
    const agentKind = tuiAgentToAgentKind(parsed.agent as TuiAgent)
    return BACKEND_BY_AGENT_KIND[agentKind] ?? 'other'
  } catch {
    return 'other'
  }
}

// SQLite's datetime('now') is UTC without a zone; the API requires an ISO datetime.
function toClientTs(completedAt: string | null | undefined): string | undefined {
  return completedAt ? `${completedAt.replace(' ', 'T')}Z` : undefined
}

type ParsedWorkerReport = {
  phase?: string
  filesModified?: string[]
  body?: string
}

export function buildStepOutcomeInput(input: {
  db: OrchestrationDb
  payload: {
    taskId: string
    dispatchId: string
    outcome: 'succeeded' | 'failed'
    result: string
  }
  worktree: { id: string; path: string; branch: string; repoId: string; projectId?: string } | null
}): StepOutcomeInput {
  const { db, payload, worktree } = input
  const parsedResult = JSON.parse(payload.result) as ParsedWorkerReport
  const task = db.getTask(payload.taskId)
  if (!task) {
    // Why throw (not default runId ''): the server rejects an empty runId anyway; failing
    // fast here lets the drainer mark the row failed without a wasted round trip.
    throw new Error(`step_outcome references unknown task ${payload.taskId}`)
  }
  const member = db.getDispatchMember(payload.dispatchId)
  const worker = db.getWorkerDispatch(payload.dispatchId)
  const strategy = db.getTaskExecutionStrategy(payload.taskId)
  const dispatchContext = db.getDispatchContextById(payload.dispatchId)

  return {
    runId: task.run_id,
    taskId: payload.taskId,
    dispatchId: payload.dispatchId,
    projectId: worktree ? (worktree.projectId ?? worktree.repoId) : undefined,
    repoId: worktree?.repoId,
    worktreeId: worktree?.id,
    branch: worktree?.branch,
    memberId: member?.memberId,
    backend:
      (member?.backend as StepOutcomeBackend | undefined) ??
      backendFromWorkerStartOptions(worker?.start_options),
    stageKey: parsedResult.phase ?? 'build',
    executionStrategy: strategy.strategy,
    outcome: payload.outcome,
    filesModified: parsedResult.filesModified ?? [],
    reportSummary: parsedResult.body?.slice(0, REPORT_SUMMARY_MAX_CHARS),
    reviewBackendBypass: member?.reviewBackendBypass ?? false,
    escalationOffered: strategy.escalationOfferedAt !== null,
    // Why: no distinct "declined" state is stored — offered-without-acceptance reads as false.
    escalationAccepted:
      strategy.escalationAcceptedAt !== null
        ? true
        : strategy.escalationOfferedAt !== null
          ? false
          : null,
    clientTs: toClientTs(dispatchContext?.completed_at)
  }
}
