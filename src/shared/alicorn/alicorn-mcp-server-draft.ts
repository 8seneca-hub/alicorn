/**
 * How an agent reaches Alicorn: one MCP server, spelled the same everywhere.
 *
 * `command` is the bare CLI name rather than a path. Alicorn already puts its own CLI wrapper on the
 * PATH of every terminal it launches (the dev build's `out/bin`, the packaged build's installed
 * bin), and that wrapper is what knows which profile's app to talk to. A resolved absolute path
 * here would be correct on the machine that wrote the file and wrong in the repository it gets
 * committed to.
 *
 * No `env`: the server holds no credentials. It reaches the running app over runtime RPC, and the
 * app resolves the control-plane bearer from its own environment — so a worker terminal, and a
 * `.mcp.json` in a shared repository, never carry a token.
 */
import type { McpServerDraft } from '../mcp-config-write'

export const ALICORN_MCP_SERVER_NAME = 'alicorn'

export const ALICORN_MCP_SERVER_DRAFT: McpServerDraft = {
  name: ALICORN_MCP_SERVER_NAME,
  command: 'alicorn',
  args: ['mcp', 'serve'],
  env: []
}

/** True when a config's `mcpServers` already carries a server by this name. */
export function hasAlicornMcpServer(serverNames: readonly string[]): boolean {
  return serverNames.includes(ALICORN_MCP_SERVER_NAME)
}
