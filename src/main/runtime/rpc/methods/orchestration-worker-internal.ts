import type { TuiAgent } from '../../../../shared/tui-agent'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import type { RunRow, TaskRow } from '../../orchestration/types'
import { assertOrchestrationWorktreeCreationSupported } from './orchestration-folder-worktree-placement'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import {
  createExistingWorktreeWorkerTerminal,
  createWorkerWorktree,
  monitorWorkerSetup,
  requireWorkerAuthority,
  type WorkerEffect,
  type WorkerSetupReceipt
} from './orchestration-worker-topology'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './orchestration-worker-setup-gate'
import { failWorkerStartWithReceipt } from './orchestration-worker-start-receipt'
import { resolveDispatchCreator } from './orchestration-dispatch-creator'
import { captureWorkerStartContext } from '../../../alicorn/context-capture-enqueue'
import { buildWorkerStartOptions } from './orchestration-worker-start-validation'
import { prepareMemberAwareWorkerStart } from './orchestration-member-worker-start'

export type StartWorkerForTaskArgs = {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  task: TaskRow
  params: WorkerStartInput
  readinessTimeoutMs: number
  // Why: committed with the starting Dispatch so crash recovery has an inspectable operation.
  // Absent for an in-process caller, which has no RPC request to attest.
  orchestrationMutation?: {
    callerFingerprint: string
    requestId: string
    method: string
    payloadHash: string
  }
}

/**
 * Starts a worker for an already-resolved Run and task: topology, terminal, setup gate, readiness,
 * then the dispatch input.
 *
 * Extracted verbatim from the `orchestration.workerStart` handler so an in-process caller — board
 * automation dispatching a column transition — can reach it without the RPC dispatcher's caller
 * authority checks, which a system Run cannot satisfy. The handler keeps everything up to and
 * including those checks and the federated branch.
 */
export async function startWorkerForTask({
  runtime,
  db,
  run,
  task,
  params,
  readinessTimeoutMs,
  orchestrationMutation
}: StartWorkerForTaskArgs) {
  const requestedWorktree = params.worktree ?? 'current'
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const { agent, launch, stampMember } = await prepareMemberAwareWorkerStart({
    params,
    createsWorktree,
    runtime,
    db,
    taskId: task.id
  })
  // SEAM (BA1, Task 12): this is unconditional today, and `showTerminal` throws for a handle with
  // no live terminal — so a system Run whose coordinator handle is `board:<repoId>` cannot get here.
  // Only the `new-*` and `current` paths below read it; resolving it lazily is what the board caller
  // needs. Left as-is here because this extraction is behaviour-preserving by contract.
  const coordinatorTerminal = await runtime.showTerminal(params.from)
  const creationWorktree = createsWorktree
    ? await runtime.showManagedWorktree(`id:${coordinatorTerminal.worktreeId}`)
    : undefined
  if (creationWorktree) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: params.repo ?? creationWorktree.repoId,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  let resolvedWorktree = creationWorktree
    ? undefined
    : requestedWorktree === 'current'
      ? await runtime.showManagedTerminalWorkspace(`id:${coordinatorTerminal.worktreeId}`)
      : await runtime.showManagedTerminalWorkspace(requestedWorktree)
  let explicitTerminal
  if (params.terminal) {
    explicitTerminal = await runtime.showTerminal(params.terminal)
    if (explicitTerminal.worktreeId !== resolvedWorktree?.id) {
      throw new OrchestrationError(
        'terminal_worktree_mismatch',
        `Terminal ${params.terminal} does not belong to worktree ${resolvedWorktree?.id}.`
      )
    }
    if (!(await runtime.isTerminalRunningAgent(params.terminal))) {
      throw new OrchestrationError(
        'agent_unconfigured',
        `Terminal ${params.terminal} is not running a recognized agent.`
      )
    }
  }

  const startOptions = buildWorkerStartOptions({
    params,
    createsWorktree,
    requestedWorktree,
    resolvedWorktreeId: resolvedWorktree?.id ?? null,
    creationRepoId: creationWorktree?.repoId ?? null,
    agent: agent ?? null,
    launchReceipt: launch.receipt,
    readinessTimeoutMs
  })
  const started = db.createStartingWorkerDispatch({
    creator: resolveDispatchCreator(runtime, params.from),
    maxDepth: runtime.getNestedWorkerMaxDepth(),
    taskId: task.id,
    retryOf: params.retryOf,
    startOptions,
    runtimeEpoch: runtime.getRuntimeId(),
    mutationReceipt: orchestrationMutation
  })
  stampMember(started.dispatch.id)
  const effects: WorkerEffect[] = []
  if (resolvedWorktree) {
    effects.push(
      { kind: 'worktree', action: 'reused', id: resolvedWorktree.id },
      { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
    )
  }
  let terminalHandle = params.terminal
  let terminalRevealWarning: string | undefined
  let failedStage = 'terminal_create'
  let setupReceipt: WorkerSetupReceipt = {
    requested: 'not_applicable',
    effective: 'not_applicable',
    source: 'existing_worktree',
    hookFound: false,
    startupPolicy: 'start-immediately',
    state: 'not_applicable'
  }
  try {
    if (creationWorktree) {
      failedStage = 'worktree_create'
      const created = await createWorkerWorktree({
        runtime,
        db,
        dispatchId: started.dispatch.id,
        requestedWorktree,
        coordinatorWorktree: creationWorktree,
        params,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        effects
      })
      resolvedWorktree = created.worktree
      terminalHandle = created.terminalHandle
      setupReceipt = created.setupReceipt
    } else if (!terminalHandle) {
      db.recordWorkerStage({
        dispatchId: started.dispatch.id,
        stage: 'terminal_creating',
        worktreeId: resolvedWorktree!.id,
        effects
      })
      const terminal = await createExistingWorktreeWorkerTerminal({
        runtime,
        worktreeId: resolvedWorktree!.id,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        taskId: task.id,
        effects
      })
      terminalHandle = terminal.handle
      terminalRevealWarning = terminal.warning
    } else {
      effects.push({
        kind: 'terminal',
        role: 'agent',
        action: 'reused',
        id: terminalHandle
      })
    }
    if (!resolvedWorktree || !terminalHandle) {
      throw new Error('Worker topology did not resolve an agent terminal and worktree.')
    }
    const setupStage = {
      db,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      terminalHandle,
      setup: setupReceipt,
      effects
    }
    if (persistGatedSetupSpawnFailure(setupStage)) {
      failedStage = 'setup_start'
      throw new Error('Setup terminal failed to start before the gated agent launch.')
    }
    persistWorkerReadinessStage(setupStage)

    failedStage = 'agent_readiness'
    const wait = await runtime.waitForTerminal(terminalHandle, {
      condition: 'tui-idle',
      timeoutMs: readinessTimeoutMs
    })
    persistWorkerSetupWaitOutcome({ ...setupStage, wait })
    if (!wait.satisfied) {
      if (setupReceipt.state === 'failed') {
        failedStage = 'setup_wait'
      }
      throw new Error(
        wait.blockedReason
          ? `Agent startup blocked: ${wait.blockedReason}`
          : `Agent did not become ready (${wait.status}).`
      )
    }
    const terminalAuthority = requireWorkerAuthority(runtime, terminalHandle)
    const capability = db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: terminalHandle,
      ...terminalAuthority,
      worktreeId: resolvedWorktree.id,
      effects,
      setupState: setupReceipt.state,
      terminalOwnership: params.terminal ? 'external' : 'created'
    })

    failedStage = 'dispatch_input'
    const preamble = buildDispatchPreamble({
      canDispatchSubWorkers: started.dispatch.depth < runtime.getNestedWorkerMaxDepth(),
      taskId: task.id,
      dispatchId: started.dispatch.id,
      taskSpec: task.spec,
      coordinatorHandle: params.from,
      workerHandle: terminalHandle,
      dispatchCapability: capability,
      devMode: params.devMode,
      cliCommand: runtime.getTerminalOrchestrationCliCommand(terminalHandle)
    })
    captureWorkerStartContext(db, runtime, params, task, started.dispatch, {
      runId: run.id,
      terminalHandle,
      preamble
    })
    await runtime.sendTerminalAgentPrompt(terminalHandle, preamble)
    effects.push({
      kind: 'dispatch_input',
      role: 'agent',
      id: terminalHandle,
      state: 'accepted'
    })
    const worker = db.markWorkerDispatchReady(started.dispatch.id, effects)
    monitorWorkerSetup({
      runtime,
      db,
      runId: run.id,
      dispatchId: started.dispatch.id,
      setupReceipt,
      effects
    })
    return {
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      state: worker.state,
      stage: worker.stage,
      setup: setupReceipt,
      launch: launch.receipt,
      timeoutMs: readinessTimeoutMs,
      effects,
      residualResources: [],
      ...(terminalRevealWarning ? { warning: terminalRevealWarning } : {})
    }
  } catch (error) {
    return failWorkerStartWithReceipt({
      db,
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      failedStage,
      error,
      setup: setupReceipt,
      launch: launch.receipt
    })
  }
}
