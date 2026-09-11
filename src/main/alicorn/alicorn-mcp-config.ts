import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ALICORN_MCP_SERVER_DRAFT } from '../../shared/alicorn/alicorn-mcp-server-draft'

/**
 * The MCP config a session Alicorn starts is pointed at.
 *
 * Written under the app's own user data rather than into the workspace, for the same reason the
 * seat config is: `worktree_path` belongs to the *execution host*, so a file written there is one
 * the main process may not own — and on an SSH host it would publish a config to a machine other
 * people reach. It is also not the repository's `.mcp.json`: that file is usually tracked, and
 * committing a server to someone's repository without asking is not ours to do.
 *
 * Rewritten on every read so a changed server definition cannot be served from a stale file.
 */
export const ALICORN_MCP_DIRNAME = 'alicorn-mcp'

export function alicornMcpConfigPath(userDataPath: string): string {
  return path.join(userDataPath, ALICORN_MCP_DIRNAME, 'mcp.json')
}

export function buildAlicornMcpConfig(): {
  mcpServers: Record<string, { command: string; args: string[] }>
} {
  return {
    mcpServers: {
      [ALICORN_MCP_SERVER_DRAFT.name]: {
        command: ALICORN_MCP_SERVER_DRAFT.command,
        args: [...ALICORN_MCP_SERVER_DRAFT.args]
      }
    }
  }
}

export async function materialiseAlicornMcpConfig(userDataPath: string): Promise<string> {
  const target = alicornMcpConfigPath(userDataPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, `${JSON.stringify(buildAlicornMcpConfig(), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  return target
}
