import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  asNonEmptyString,
  attemptControlPlane as attempt,
  type AlicornFailure
} from './alicorn-control-plane-result'
import type { RequiredCheck } from '../../shared/alicorn/members'

/**
 * The org library's admin-authored surface. Split from `alicorn-handlers` only for length.
 */
export function registerAlicornLibraryHandlers(deps: { client: ControlPlaneClient | null }): void {
  ipcMain.handle(
    ALICORN_IPC.requiredChecksGet,
    async (
      _event,
      args: { projectId?: unknown }
    ): Promise<{ ok: true; checks: RequiredCheck[] } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        checks: await client.getRequiredChecks(projectId)
      }))
    }
  )

  // Admin-authored, per project: the members a check judges never reach this handler, and the
  // Control API is still the authority on what a check may say.
  ipcMain.handle(
    ALICORN_IPC.requiredChecksSet,
    async (
      _event,
      args: { projectId?: unknown; checks?: unknown }
    ): Promise<{ ok: true; checks: RequiredCheck[] } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      if (!projectId || !Array.isArray(args?.checks)) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        checks: await client.setRequiredChecks(projectId, args.checks as RequiredCheck[])
      }))
    }
  )
}
