/**
 * The org policy: what every project's stage starts from, and the reviewer-backend rule.
 *
 * Its own file because it is the one org-wide write there is — everything else an admin authors is
 * per project. Keeping it here means a reader looking for "what can an org set" finds one file
 * rather than two handlers buried among twenty.
 */
import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { OrgPolicy } from '../../shared/alicorn/members'
import { attemptControlPlane as attempt, type AlicornFailure } from './alicorn-control-plane-result'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'

export function registerAlicornOrgPolicyHandlers(deps: {
  client: ControlPlaneClient | null
}): void {
  ipcMain.handle(
    ALICORN_IPC.orgPolicyGet,
    async (): Promise<{ ok: true; policy: OrgPolicy } | AlicornFailure> =>
      attempt(deps.client, async (client) => ({
        ok: true as const,
        policy: await client.getOrgPolicy()
      }))
  )

  ipcMain.handle(
    ALICORN_IPC.orgPolicySet,
    async (
      _event,
      args: { policy?: unknown }
    ): Promise<{ ok: true; policy: OrgPolicy } | AlicornFailure> => {
      const policy = args?.policy
      if (!policy || typeof policy !== 'object') {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        policy: await client.putOrgPolicy(policy as OrgPolicy)
      }))
    }
  )
}
