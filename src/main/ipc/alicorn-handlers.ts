import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  asNonEmptyString,
  attemptControlPlane as attempt,
  type AlicornFailure
} from './alicorn-control-plane-result'
import { registerAlicornWorkflowHandlers } from './alicorn-workflow-handlers'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { ExecutionStrategy } from '../../shared/alicorn/ledger'
import type { Member, MemberInput, OrgPolicy } from '../../shared/alicorn/members'
import type { Project, ProjectInput } from '../../shared/alicorn/projects'
import type { ForemanRunViewResult } from '../../shared/alicorn/foreman-run'
import { readForemanRunView } from '../alicorn/foreman/run-view-source'
import type { ProvenanceViewResult } from '../../shared/alicorn/provenance-view'
import { readProvenanceView } from '../alicorn/provenance-source'
import type {
  ContextCaptureDetailResult,
  RunInspectorViewResult
} from '../../shared/alicorn/run-inspector-view'
import { readRunInspectorView } from '../alicorn/run-inspector-source'
import type { GateResolveResult, PendingGatesResult } from '../../shared/alicorn/gate-review'
import { isAdvisory } from '../../shared/alicorn/gate-review'
import { listPendingGateViews } from '../alicorn/gates/pending-gate-view'
import { enqueueGateAgreement, isGateVerdict } from '../alicorn/gates/gate-agreement'

export type { AlicornFailure } from './alicorn-control-plane-result'

export type AlicornHandlerDeps = {
  client: ControlPlaneClient | null
  getOrchestrationDb: () => OrchestrationDb
  /** Null for a workspace this host cannot resolve, which reads as "no run" rather than an error. */
  resolveWorktreePath?: (worktreeId: string) => Promise<string | null>
}

function asMemberInput(value: unknown): MemberInput | null {
  // The control plane validates the full shape; this only rejects payloads that
  // are not an object at all, so a malformed invoke fails here rather than as a
  // confusing 400 from the server.
  return value && typeof value === 'object' ? (value as MemberInput) : null
}

/** Same reasoning as asMemberInput: reject a non-object here, leave the shape to the server. */
function asProjectInput(value: unknown): ProjectInput | null {
  return value && typeof value === 'object' ? (value as ProjectInput) : null
}

/** Registers every `alicorn:*` IPC handler on the main process. */
export function registerAlicornHandlers(deps: AlicornHandlerDeps): void {
  ipcMain.handle(
    ALICORN_IPC.projectsList,
    async (): Promise<{ ok: true; projects: Project[] } | AlicornFailure> =>
      attempt(deps.client, async (client) => ({
        ok: true as const,
        projects: await client.listProjects()
      }))
  )

  ipcMain.handle(
    ALICORN_IPC.projectsCreate,
    async (_event, input: unknown): Promise<{ ok: true; project: Project } | AlicornFailure> => {
      const projectInput = asProjectInput(input)
      if (!projectInput) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        project: await client.createProject(projectInput)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.projectsUpdate,
    async (
      _event,
      args: { id?: unknown; input?: unknown }
    ): Promise<{ ok: true; project: Project } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      const projectInput = asProjectInput(args?.input)
      if (!id || !projectInput) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        project: await client.updateProject(id, projectInput)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.projectsDelete,
    async (_event, args: { id?: unknown }): Promise<{ ok: true } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      if (!id) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => {
        await client.deleteProject(id)
        return { ok: true as const }
      })
    }
  )

  ipcMain.handle(
    ALICORN_IPC.membersList,
    async (): Promise<{ ok: true; members: Member[] } | AlicornFailure> =>
      attempt(deps.client, async (client) => ({
        ok: true as const,
        members: await client.listMembers()
      }))
  )

  ipcMain.handle(
    ALICORN_IPC.membersCreate,
    async (_event, input: unknown): Promise<{ ok: true; member: Member } | AlicornFailure> => {
      const memberInput = asMemberInput(input)
      if (!memberInput) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        member: await client.createMember(memberInput)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.membersUpdate,
    async (
      _event,
      args: { id?: unknown; input?: unknown }
    ): Promise<{ ok: true; member: Member } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      const memberInput = asMemberInput(args?.input)
      if (!id || !memberInput) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        member: await client.updateMember(id, memberInput)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.membersDelete,
    async (_event, args: { id?: unknown }): Promise<{ ok: true } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      if (!id) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => {
        await client.deleteMember(id)
        return { ok: true as const }
      })
    }
  )

  ipcMain.handle(
    ALICORN_IPC.orgPolicyGet,
    async (): Promise<{ ok: true; policy: OrgPolicy } | AlicornFailure> =>
      attempt(deps.client, async (client) => ({
        ok: true as const,
        policy: await client.getOrgPolicy()
      }))
  )

  ipcMain.handle(
    ALICORN_IPC.tasksSetExecutionStrategy,
    async (
      _event,
      args: { taskId?: unknown; strategy?: unknown; source?: unknown }
    ): Promise<{ ok: boolean }> => {
      const taskId = asNonEmptyString(args?.taskId)
      const strategy = args?.strategy
      const source = args?.source
      if (
        !taskId ||
        (strategy !== 'single' && strategy !== 'orchestrated') ||
        (source !== 'user' && source !== 'escalation')
      ) {
        return { ok: false }
      }
      // setTaskExecutionStrategy already stamps escalation_accepted_at when the
      // source is 'escalation', so acceptance needs no second call.
      deps
        .getOrchestrationDb()
        .setTaskExecutionStrategy(taskId, strategy as ExecutionStrategy, source)
      return { ok: true }
    }
  )

  // Why a plain read and not a subscription: the journal changes at dispatch speed, not frame
  // speed, so the view polls while it is open rather than the main process watching every
  // workspace for a panel that is usually closed.
  ipcMain.handle(
    ALICORN_IPC.foremanJournal,
    async (_event, args: { worktreeId?: unknown }): Promise<ForemanRunViewResult> => {
      const worktreeId = asNonEmptyString(args?.worktreeId)
      if (!worktreeId || !deps.resolveWorktreePath) {
        return { state: 'none' }
      }
      const worktreePath = await deps.resolveWorktreePath(worktreeId)
      if (!worktreePath) {
        return { state: 'none' }
      }
      return readForemanRunView(worktreePath)
    }
  )

  // The panel's read. It goes through the same `readProvenanceView` D6's pull-request body uses,
  // so the two can never disagree about a run, and it returns the projection rather than the raw
  // report so the member directory is resolved once here instead of in every renderer.
  ipcMain.handle(
    ALICORN_IPC.provenanceGet,
    async (_event, args: { repoId?: unknown; branch?: unknown }): Promise<ProvenanceViewResult> => {
      const repoId = asNonEmptyString(args?.repoId)
      const branch = asNonEmptyString(args?.branch)
      if (!repoId || !branch) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => {
        const view = await readProvenanceView(client, repoId, branch)
        // `readProvenanceView` swallows the ledger read's own failure, so a null here means the
        // ledger had nothing to say — an empty view, not an error the panel should shout about.
        return view
          ? { ok: true as const, view }
          : { ok: false as const, error: 'provenance_unavailable' }
      })
    }
  )

  // UI3's read. One invoke rather than three so the branch's provenance, the run's captures and
  // the run's cost are resolved together and cannot describe different runs.
  ipcMain.handle(
    ALICORN_IPC.runInspectorGet,
    async (
      _event,
      args: { repoId?: unknown; branch?: unknown; runId?: unknown }
    ): Promise<RunInspectorViewResult> => {
      const repoId = asNonEmptyString(args?.repoId)
      const branch = asNonEmptyString(args?.branch)
      if (!repoId || !branch) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => {
        const view = await readRunInspectorView(
          client,
          repoId,
          branch,
          asNonEmptyString(args?.runId)
        )
        return view
          ? { ok: true as const, view }
          : { ok: false as const, error: 'provenance_unavailable' }
      })
    }
  )

  // Separate from the run read on purpose: a prompt reaches 64 KiB, so exactly one crosses IPC and
  // only because a reader asked for it. A missing capture surfaces as this client's `not_found`.
  ipcMain.handle(
    ALICORN_IPC.contextCaptureGet,
    async (
      _event,
      args: { runId?: unknown; dispatchId?: unknown }
    ): Promise<ContextCaptureDetailResult> => {
      const runId = asNonEmptyString(args?.runId)
      const dispatchId = asNonEmptyString(args?.dispatchId)
      if (!runId || !dispatchId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        capture: await client.getRunContextCapture(runId, dispatchId)
      }))
    }
  )

  // Pending gates for the gate panel. A local read of the client's own orchestration store —
  // the recommendation was computed and recorded when the gate opened (GP1), and re-deriving it
  // here would show a verdict the human is then measured against but never saw.
  ipcMain.handle(ALICORN_IPC.gatesList, async (): Promise<PendingGatesResult> => {
    try {
      return { ok: true, gates: listPendingGateViews(deps.getOrchestrationDb()) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'gates_unavailable' }
    }
  })

  // Resolving from the panel also records GP3's agreement. `recommendationShown` is derived from
  // the level stored on the gate row — the same test that decided whether to send it in the
  // first place — so what is measured is exactly what was on screen, not what a caller claims.
  ipcMain.handle(
    ALICORN_IPC.gatesResolve,
    async (
      _event,
      args: { gateId?: unknown; resolution?: unknown; humanGateDecision?: unknown }
    ): Promise<GateResolveResult> => {
      const gateId = asNonEmptyString(args?.gateId)
      const resolution = asNonEmptyString(args?.resolution)
      const decision = args?.humanGateDecision
      if (!gateId || !resolution || !isGateVerdict(decision)) {
        return { ok: false, error: 'invalid_body' }
      }
      const db = deps.getOrchestrationDb()
      const pending = db.getGate(gateId)
      if (!pending || pending.status !== 'pending') {
        return { ok: false, error: 'gate_not_pending' }
      }
      const recommendationShown = isAdvisory(pending.recommended_level)
      const gate = db.resolveGate(gateId, resolution)
      if (!gate) {
        return { ok: false, error: 'gate_not_found' }
      }
      return {
        ok: true,
        agreementRecorded: enqueueGateAgreement(db, gate, { decision, recommendationShown }) > 0
      }
    }
  )

  registerAlicornWorkflowHandlers(deps)
}
