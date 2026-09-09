import { app } from 'electron'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getLocalPtyProvider, getSshPtyProvider, clearProviderPtyState } from '../ipc/pty'
import { agentHookServer } from '../agent-hooks/server'
import { browserManager } from '../browser/browser-manager'
import { loadAgentSessionClaimSigner } from '../runtime/agent-session-claim-identity'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { prepareCodexAiVaultSessionResume } from '../codex/codex-ai-vault-session-resume'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { getDaemonProvider } from '../daemon/daemon-init'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import type { OrchestrationEnvironmentTransport } from '../runtime/orchestration/environment-transport'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { fingerprintOrchestrationPeer } from '../runtime/orchestration/environment-transport'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { mainProcessState as state } from './main-process-state'
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import type { RuntimeDesktopWindowStatus } from '../../shared/runtime-types'
import { ArtifactCloudService } from '../artifacts/artifact-cloud-service'
import { SkillCloudService } from '../skills/skill-cloud-service'
import { isArtifactSharingEnabled } from '../../shared/artifact-sharing-gate'
import { startCorrectionsSweep } from '../alicorn/corrections/corrections-sweep'
import { startOutboxRetention } from '../alicorn/outbox-retention'
import { startLedgerOutboxDrainer } from '../alicorn/ledger-outbox-drainer'
import { startVerificationWorker } from '../alicorn/verification-worker'
import { createLedgerWriter } from '../alicorn/ledger/ledger-writer'
import { attributeDispatchUsage } from '../alicorn/run-usage-attribution'
import { startContextCeilingWatcher } from '../alicorn/context-ceiling-watcher'
import { startRunCostPublisher } from '../alicorn/run-cost-publisher'
import { ALICORN_EVENTS } from '../../shared/alicorn/ipc-channels'
import { ALICORN_RUN_COST_EVENT } from '../../shared/alicorn/run-cost'
import { createVerificationRunner } from '../alicorn/diff-coverage/verification-runner'
import { runContractAcknowledgedCheck } from '../alicorn/contracts/contract-acknowledged-check'
import { fetchAcknowledgedContractNames } from '../alicorn/contracts/contract-acknowledgements-fetch'
import { fetchRequiredChecks } from '../alicorn/diff-coverage/required-checks-fetch'
import { runDiffCoverageCheck } from '../alicorn/diff-coverage/diff-coverage-check'
import { createBaseRefResolver } from '../alicorn/diff-coverage/base-ref-resolver'
import { createRunBlastRadiusSource } from '../alicorn/gates/run-blast-radius'
import { createWorktreeChangedFilesReader } from '../alicorn/gates/worktree-changed-files'
import { createDispatchSpendReader } from '../alicorn/gates/dispatch-spend-reader'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { getAlicornControlPlaneUrls } from '../alicorn/control-plane-urls'
import { isAlicornBearerConfigured } from '../alicorn/control-plane-session'
import { createMemberDirectory } from '../alicorn/member-directory'
import { getControlPlaneClient } from '../alicorn/control-plane-client-instance'

const LEDGER_OUTBOX_DRAIN_INTERVAL_MS = 5_000
const CORRECTIONS_SWEEP_INTERVAL_MS = 600_000

export function getDesktopWindowStatus(): RuntimeDesktopWindowStatus {
  const activation = state.desktopActivationGate
  if (!activation) {
    return 'available'
  }
  const value = activation.getState()
  return value === 'ready' ? 'openable' : value
}

export function initializeMainProcessRuntime(): OrcaRuntimeService {
  const store = state.store
  const stats = state.stats
  if (!store || !stats) {
    throw new Error('Store and stats must be initialized before runtime')
  }
  const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {
    resolve: (selector) => {
      const environment = resolveEnvironment(app.getPath('userData'), selector)
      const pairing = getPreferredPairingOffer(environment)
      return {
        environmentId: environment.id,
        name: environment.name,
        peerFingerprint: fingerprintOrchestrationPeer(pairing.publicKeyB64)
      }
    },
    call: (selector, method, params, timeoutMs, envelope) =>
      callRuntimeEnvironment(
        app.getPath('userData'),
        selector,
        method,
        params,
        timeoutMs,
        undefined,
        envelope
      )
  }
  const runtime = new OrcaRuntimeService(store, stats, {
    agentSessionClaimSigner: loadAgentSessionClaimSigner(
      getProfileUserDataPath(),
      getProfileUserDataPath()
    ),
    // Why: resolve the PTY provider lazily — a daemon swap happens later, so an eager reference would freeze the pre-daemon provider (design §4.3).
    getLocalProvider: () => getLocalPtyProvider(),
    // Why: SSH relay providers register after construction and may reconnect, so destructive cleanup must resolve the current generation.
    getSshProvider: (connectionId) => getSshPtyProvider(connectionId),
    onPtyStopped: clearProviderPtyState,
    onTerminalAgentStatus: (event) => agentHookServer.ingestTerminalStatus(event),
    // Why: serve can be promoted in place, so wire the listener from startup; runtime enables desktop-only scanners only for a ready renderer.
    onTerminalSideEffects: (batch: TerminalSideEffectBatch) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('pty:sideEffect', batch)
      }
    },
    getDesktopWindowStatus,
    // Why: worktree.ps pulls hook-reported agent status (same source as the desktop sidebar) at query time so mobile shows the same agents.
    getAgentStatusSnapshot: () =>
      agentHookServer.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true),
    // Why: the filter above hides resume-identity rows from the live-agent views, but
    // those rows carry the provider session mobile native chat addresses transcripts
    // by — Pi publishes identity that way and would otherwise be unreachable.
    getAgentProviderSessionSnapshot: () => agentHookServer.getStatusSnapshot(),
    getAgentProviderSessionRowsForPane: (paneKey) =>
      agentHookServer.getStatusSnapshotForPane(paneKey),
    attestAgentHookCompatibilityAuthority: (candidate) =>
      agentHookServer.attestCompatibilityAuthority(candidate),
    retireAgentHookCompatibilityAuthority: (paneKey) =>
      agentHookServer.retirePaneAuthority(paneKey),
    reconcileAgentStatusForEndedProcess: (paneKeys) =>
      agentHookServer.reconcileEndedProcessForPaneKeys(paneKeys),
    canRecoverPersistentLocalPtys: () => getDaemonProvider() !== null,
    // Why: evaluated per call, not captured — the RPC server that owns the device registry is
    // constructed with this runtime and does not exist yet at this point.
    getPairedDeviceName: (pairedDeviceId) =>
      state.runtimeRpc?.getDeviceRegistry()?.getDevice(pairedDeviceId)?.name ?? null,
    // Why: source codex-home here (runs in window AND serve) so aiVault.listSessions includes managed-Codex sessions; registerCoreHandlers is window-only.
    getAdditionalAiVaultCodexHomePaths: () =>
      state.codexRuntimeHome?.getHostCodexHomePathsForSessionDiscovery() ?? [],
    prepareAiVaultSessionResume: (args) =>
      prepareCodexAiVaultSessionResume(args, {
        runtimeHome: state.codexRuntimeHome,
        systemCodexHomePath: resolveHostCodexSessionSourceHome(store.getSettings())
      }),
    prepareCodexStructuredLaunch: ({ workspacePath, launchEnv }) =>
      prepareCodexRuntimeHomeForLaunch(undefined, launchEnv, {
        launchAgent: 'codex',
        workspacePath
      }),
    buildAgentHookPtyEnv: () =>
      isAgentStatusHooksEnabled(state.store?.getSettings()) ? agentHookServer.buildPtyEnv() : {},
    orchestrationEnvironmentTransport,
    skillTransactionRecovery: state.skillTransactionRecovery
  })
  state.runtime = runtime
  // Why: C3's own writer instance over B1's alicornFetch — never B2's control-plane client.
  const ledgerWriter = createLedgerWriter()
  const verificationRunner = createVerificationRunner({
    fetchRequiredChecks,
    runDiffCoverageCheck,
    runContractAcknowledgedCheck: (input) =>
      runContractAcknowledgedCheck({
        ...input,
        listAcknowledgedNames: fetchAcknowledgedContractNames
      }),
    resolveBaseRef: createBaseRefResolver({
      store,
      showManagedWorktree: (selector) => runtime.showManagedWorktree(selector)
    }),
    resolveWorktreeHost: async (worktreeId) => {
      try {
        const worktree = await runtime.showManagedWorktree(`id:${worktreeId}`)
        return !worktree.hostId || worktree.hostId === LOCAL_EXECUTION_HOST_ID ? 'local' : 'remote'
      } catch {
        return 'unknown'
      }
    }
  })
  // BR1: what the run has already changed and spent, for the blast-radius budgets. Reuses D6's
  // authored base-ref resolution and C5's spend attribution rather than measuring either twice.
  runtime.setAlicornBlastRadiusSource(
    createRunBlastRadiusSource({
      getDb: () => runtime.getOrchestrationDb(),
      readChangedFiles: createWorktreeChangedFilesReader({
        showManagedWorktree: (selector) => runtime.showManagedWorktree(selector),
        resolveBaseRef: createBaseRefResolver({
          store,
          showManagedWorktree: (selector) => runtime.showManagedWorktree(selector)
        })
      }),
      // Why lazy: usage stores are created after the runtime, so read state.* at call time.
      readDispatchSpendCents: createDispatchSpendReader({
        claudeUsage: () => state.claudeUsage ?? null,
        codexUsage: () => state.codexUsage ?? null
      })
    })
  )
  state.ledgerOutboxDrainer = startLedgerOutboxDrainer({
    getDb: () => runtime.getOrchestrationDb(),
    runtime,
    writer: ledgerWriter,
    // Why lazy: usage stores are created after the drainer starts, so read state.* at call time.
    spendAttributor: (input) =>
      attributeDispatchUsage({
        ...input,
        claudeUsage: state.claudeUsage,
        codexUsage: state.codexUsage
      }),
    // RB1: the verdict this row carries is also what proposes a standing rule on the member.
    proposeRule: (input) => getControlPlaneClient().createRuleProposal(input),
    // Why excluded here: step_verification rows run a project's own coverage/test command,
    // which can take minutes — the verification worker below gives them their own timer and
    // row timeout so a slow project can't queue every other ledger write behind it (LG2a).
    excludeKinds: ['step_verification'],
    intervalMs: LEDGER_OUTBOX_DRAIN_INTERVAL_MS
  })
  // Why after the drainer: same settled-state read, and it consumes the step_verification
  // rows the drainer's step_outcome handling just enqueued.
  state.verificationWorker = startVerificationWorker({
    getDb: () => runtime.getOrchestrationDb(),
    writer: ledgerWriter,
    verificationRunner
  })
  // Why next to the drainer: same settled-state read, and corrections patch the
  // outcomes the drainer just posted.
  state.correctionsSweep = startCorrectionsSweep({
    getDb: () => runtime.getOrchestrationDb(),
    runtime,
    store,
    intervalMs: CORRECTIONS_SWEEP_INTERVAL_MS
  })
  // Why next to the sweeps above: same settled-state read. Startup order is not what keeps this
  // safe -- registration order does not decide fire order. The age predicate does: a row must be
  // both delivered and 30 days old to expire, so no sweep can outrun the drainer (LG3).
  state.outboxRetention = startOutboxRetention({
    getDb: () => runtime.getOrchestrationDb()
  })
  runtime.prepareLegacyWorkerTerminalRecovery()
  // Why before anything can attach: a client host that reattaches to a restarted runtime is only
  // handed its pages back if the runtime found them first.
  runtime.rehydrateClientHostedBrowserPages()
  state.publishProviderSessionChanges?.(agentHookServer.getProviderSessionIdentities())
  browserManager.setBrowserGuestStateChangedListener((worktreeId) => {
    runtime.notifyMobileSessionTabsChanged(worktreeId)
  })
  return runtime
}

export function configureRuntimeServices(runtime: OrcaRuntimeService): void {
  const store = state.store
  const claudeAccounts = state.claudeAccounts
  const codexAccounts = state.codexAccounts
  const rateLimits = state.rateLimits
  if (!store || !claudeAccounts || !codexAccounts || !rateLimits) {
    throw new Error('Account services must be initialized before runtime wiring')
  }
  runtime.setArtifactService(
    new ArtifactCloudService(app.getPath('userData'), () =>
      isArtifactSharingEnabled(state.store?.getSettings())
    )
  )
  runtime.setSkillCloudService(new SkillCloudService(app.getPath('userData')))
  runtime.setAccountServices({ claudeAccounts, codexAccounts, rateLimits })
  // Why: the ceiling watcher reads only settled state (dispatch rows plus already-scanned
  // transcripts), so starting it here costs nothing until a claude worker is actually running.
  state.contextCeilingWatcher?.stop()
  state.contextCeilingWatcher = startContextCeilingWatcher({
    getDb: () => (state.runtime ? state.runtime.getOrchestrationDb() : null),
    claudeUsage: state.claudeUsage,
    publish: (offer) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send(ALICORN_EVENTS.escalationOffer, offer)
      }
    },
    // Why the runtime and not the window: a lead's compaction prompt goes to its own pane, which
    // exists whether or not anyone is looking at it.
    sendPrompt: (terminalHandle, prompt) => runtime.sendTerminalAgentPrompt(terminalHandle, prompt)
  })
  // Null when the control plane is unconfigured; --member is rejected then
  // rather than launching a worker with no member to record. Configured is the most
  // startup can know in keycloak mode -- whether a session exists needs disk and network,
  // so a signed-out call fails at the request rather than removing the feature.
  runtime.setAlicornMemberDirectory(
    getAlicornControlPlaneUrls(process.env) && isAlicornBearerConfigured(process.env)
      ? createMemberDirectory(getControlPlaneClient())
      : null
  )
  // Why: same settled-state read as the ceiling watcher — no cost until a dispatch is running.
  state.runCostPublisher?.stop()
  state.runCostPublisher = startRunCostPublisher({
    getDb: () => (state.runtime ? state.runtime.getOrchestrationDb() : null),
    claudeUsage: state.claudeUsage,
    codexUsage: state.codexUsage,
    publish: (payload) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send(ALICORN_RUN_COST_EVENT, payload)
      }
    }
  })
  runtime.setCommitMessageAgentEnvironmentResolvers({
    // Why: Codex hooks/auth live in Orca's managed runtime home even for the default path, so every launch must resolve CODEX_HOME via runtime-home.
    prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
    prepareForClaudeLaunch: (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target)
  })
}
