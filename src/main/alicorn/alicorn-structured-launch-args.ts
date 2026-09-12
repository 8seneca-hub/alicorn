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
import { buildClaudeAgentsArgument } from '../../shared/alicorn/default-members'
import { alicornMcpConfigPath } from './alicorn-mcp-config'

const MCP_CONFIG_FLAG = '--mcp-config'
const AGENTS_FLAG = '--agents'

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
function hasFlag(tokens: readonly string[], flag: string): boolean {
  return tokens.some((token) => token === flag || token.startsWith(`${flag}=`))
}

export function alicornStructuredClaudeArgs(
  tokens: readonly string[],
  userDataPath: string,
  fileExists: (path: string) => boolean = existsSync
): string[] {
  const next = [...tokens]

  // `--mcp-config` last among Alicorn's own flags would be a trap: it is variadic, so a bare
  // positional after it is read as a second config path. Nothing here appends a positional, and
  // nothing should.
  if (!hasMcpConfigFlag(next)) {
    const configPath = alicornMcpConfigPath(userDataPath)
    if (fileExists(configPath)) {
      next.push(MCP_CONFIG_FLAG, configPath)
    }
  }

  // Alicorn's core members, as subagents Claude can actually delegate to. Passed on the command
  // line rather than written to `.claude/agents/`: that directory belongs to the repository or to
  // the user, and neither is ours to add files to. Claude Code validates this JSON at startup and
  // exits on a bad value, so it is built from typed definitions rather than assembled by hand.
  if (!hasFlag(next, AGENTS_FLAG)) {
    next.push(AGENTS_FLAG, buildClaudeAgentsArgument())
  }

  return next
}
