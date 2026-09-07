import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../alicorn/control-plane-http'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { ExecutionStrategy } from '../../shared/alicorn/ledger'
import type { Member, MemberInput, OrgPolicy } from '../../shared/alicorn/members'
import type { ForemanRunViewResult } from '../../shared/alicorn/foreman-run'
import { readForemanRunView } from '../alicorn/foreman/run-view-source'

export type AlicornFailure = { ok: false; error: string }

const UNCONFIGURED: AlicornFailure = { ok: false, error: 'control_plane_unconfigured' }

export type AlicornHandlerDeps = {
  client: ControlPlaneClient | null
  getOrchestrationDb: () => OrchestrationDb
  /** Null for a workspace this host cannot resolve, which reads as "no run" rather than an error. */
  resolveWorktreePath?: (worktreeId: string) => Promise<string | null>
}

// A control-plane failure is a result the renderer can render, not a rejected
// invoke: the Members pane has to say *why* it is empty.
async function attempt<T extends object>(
  client: ControlPlaneClient | null,
  run: (client: ControlPlaneClient) => Promise<T>
): Promise<T | AlicornFailure> {
  if (!client) {
    return UNCONFIGURED
  }
  try {
    return await run(client)
  } catch (error) {
    if (error instanceof ControlPlaneUnavailableError) {
      return { ok: false, error: error.code }
    }
    if (error instanceof ControlPlaneRequestError) {
      return { ok: false, error: error.code }
    }
    throw error
  }
}

function asMemberInput(value: unknown): MemberInput | null {
  // The control plane validates the full shape; this only rejects payloads that
  // are not an object at all, so a malformed invoke fails here rather than as a
  // confusing 400 from the server.
  return value && typeof value === 'object' ? (value as MemberInput) : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Registers every `alicorn:*` IPC handler on the main process. */
export function registerAlicornHandlers(deps: AlicornHandlerDeps): void {
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
}
