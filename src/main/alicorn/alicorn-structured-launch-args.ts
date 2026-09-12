/**
 * Alicorn's MCP server, attached to every structured Claude session this host starts.
 *
 * A structured session is not launched from a terminal, so the `--mcp-config` a startup command
 * carries never reaches one. The host's own configured launch args do: they are translated into
 * SDK options one flag at a time, and a flag with no typed option becomes `extraArgs`, which is
 * how `--mcp-config` survives the trip to the CLI.
 *
 * Fail-closed on a missing file. `claude --mcp-config <absent path>` exits, so a config that has
 * not been written yet must cost the session its tools, never its start.
 */
import { existsSync } from 'node:fs'
import { alicornMcpConfigPath } from './alicorn-mcp-config'

const MCP_CONFIG_FLAG = '--mcp-config'

function hasMcpConfigFlag(tokens: readonly string[]): boolean {
  return tokens.some(
    (token) => token === MCP_CONFIG_FLAG || token.startsWith(`${MCP_CONFIG_FLAG}=`)
  )
}

/**
 * Appends Alicorn's MCP config to a Claude session's launch args.
 *
 * Idempotent, and it yields to the user: someone who configured `--mcp-config` by hand in their
 * default agent args meant that file, and a second flag would be the one Claude ignores.
 */
export function alicornStructuredClaudeArgs(
  tokens: readonly string[],
  userDataPath: string,
  fileExists: (path: string) => boolean = existsSync
): string[] {
  if (hasMcpConfigFlag(tokens)) {
    return [...tokens]
  }
  const configPath = alicornMcpConfigPath(userDataPath)
  return fileExists(configPath) ? [...tokens, MCP_CONFIG_FLAG, configPath] : [...tokens]
}
