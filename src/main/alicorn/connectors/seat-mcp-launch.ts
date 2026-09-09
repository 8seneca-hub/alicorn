import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import type { MemberBackend } from '../../../shared/alicorn/members'
import type { MemberDirectory } from '../member-directory'
import type { RestrictedPaneLaunch } from '../agent-pane-role'
import type { AgentLaunchRestrictions } from '../../runtime/runtime-terminal-contracts'
import { materialiseSeatMcpConfig, seatMcpConfigSupported } from './seat-mcp-config'

/**
 * OP3's one call site: what this launch's seat may run, written to a file the launch points at.
 *
 * Every failure answers null, and null means "pass no `--mcp-config`" — the pre-OP3 surface. That
 * is the narrow default in every case that matters: no member, no control plane, no seat, no
 * connectors, a backend with no per-launch config flag, or a write that failed. A seat that cannot
 * be resolved withholds a connector; it never inherits the organisation's or another seat's.
 */
export async function resolveSeatMcpConfigForLaunch(input: {
  directory: MemberDirectory | null
  backend: MemberBackend | null
  userDataPath?: string
}): Promise<string | null> {
  if (!input.directory || !input.backend || !seatMcpConfigSupported(input.backend)) {
    return null
  }
  try {
    const { connectors } = await input.directory.getSeatConnectors()
    return await materialiseSeatMcpConfig({
      userDataPath: input.userDataPath ?? getProfileUserDataPath(),
      // The seat holder's internal id travels on the connectors themselves, so the desktop never
      // has to know its own — and with no connectors there is nothing to name a file after.
      seatUserId: connectors[0]?.userId ?? null,
      connectors
    })
  } catch (error) {
    console.warn('[alicorn] seat MCP connectors unavailable — launching without them', error)
    return null
  }
}

/**
 * A restricted role and a seat-scoped connector set are independent, and merging them here is what
 * lets a collaborator's launch carry its connectors without becoming a `RestrictedPaneLaunch` —
 * which would refuse worktree creation for every collaborator.
 */
export function mergeSeatLaunchRestrictions(
  restrictedLaunch: RestrictedPaneLaunch | null,
  seatMcpConfigPath: string | null
): AgentLaunchRestrictions | null {
  if (!restrictedLaunch && !seatMcpConfigPath) {
    return null
  }
  return {
    ...restrictedLaunch?.restrictions,
    ...(seatMcpConfigPath ? { mcpConfigPath: seatMcpConfigPath } : {})
  }
}
