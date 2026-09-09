import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MemberBackend } from '../../../shared/alicorn/members'
import type { SeatConnector } from '../../../shared/alicorn/seat-connectors'

/**
 * OP3 — the seat's MCP connectors as a config file the launch points one agent at.
 *
 * Why a file per seat rather than a shared `.mcp.json`: a seat is a *narrowing*. A collaborator's
 * connectors must reach that collaborator's agent and nothing else, and the expensive mistake is a
 * collaborator resolving a connector a builder was meant to hold. A file named for the seat holder
 * makes "which seat is this" a property of the path rather than of whoever wrote it last.
 *
 * Why under the app's own user data and not the workspace: `worktree_path` belongs to the
 * *execution host*, so a file written into a workspace is a file the main process may not own — and
 * on an SSH host it would be a per-seat config published to a machine other people reach. The
 * launch only applies it locally (see `appendSeatMcpConfigLaunchArgs`' caller).
 */
export const SEAT_MCP_DIRNAME = 'alicorn-seat-mcp'

export type SeatMcpConfig = {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
}

/**
 * Env is emitted as `${NAME}` rather than a value, which is the whole reason the control plane
 * stores names: the secret is resolved by the seat holder's own process at launch and never
 * travels through — or rests in — the control plane, this file, or a process argument.
 */
export function buildSeatMcpConfig(connectors: readonly SeatConnector[]): SeatMcpConfig {
  const mcpServers: SeatMcpConfig['mcpServers'] = {}
  for (const connector of connectors) {
    mcpServers[connector.kind] = {
      command: connector.server.command,
      args: [...connector.server.args],
      env: Object.fromEntries(connector.server.env.map((name) => [name, `\${${name}}`]))
    }
  }
  return { mcpServers }
}

/** One path per seat holder, so two seats on one machine can never read each other's file. */
export function seatMcpConfigPath(userDataPath: string, seatUserId: string): string {
  const safe = seatUserId.replace(/[^A-Za-z0-9_-]/g, '_')
  return path.join(userDataPath, SEAT_MCP_DIRNAME, `mcp.${safe}.json`)
}

/**
 * Writes the seat's config and answers its path, or null when there is nothing to scope.
 *
 * Null is the fail-closed answer and it covers every unresolvable case at once — no seat, no
 * connectors, no signed-in user. The launch then passes no `--mcp-config` and the agent sees
 * exactly what it saw before OP3: the workspace's own committed config, never another seat's.
 */
export async function materialiseSeatMcpConfig(input: {
  userDataPath: string
  seatUserId: string | null
  connectors: readonly SeatConnector[]
}): Promise<string | null> {
  if (!input.seatUserId || input.connectors.length === 0) {
    return null
  }
  const target = seatMcpConfigPath(input.userDataPath, input.seatUserId)
  await fs.mkdir(path.dirname(target), { recursive: true })
  // Rewritten every launch: a connector an admin revoked must not survive in a stale file.
  await fs.writeFile(target, `${JSON.stringify(buildSeatMcpConfig(input.connectors), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  return target
}

/**
 * Which backends can be handed a config for one launch. Withholding is safe — the agent keeps the
 * pre-OP3 surface — so an unsupported backend loses the connector rather than refusing the launch,
 * unlike the QA blindfold, where withholding the restriction is what would be unsafe.
 */
export function seatMcpConfigSupported(backend: MemberBackend): boolean {
  return backend === 'claude' || backend === 'openclaude'
}
