/**
 * Adding one server to an MCP config file, without losing what is already in it.
 *
 * These files are hand-edited and shared with other tools — Cursor and Claude read the same
 * `mcpServers` object — so the write has to be a merge, and it has to refuse rather than guess.
 * A file we cannot parse is a file someone is mid-edit in, or one with comments we would strip:
 * overwriting it to add a server would cost more than it gains, so `invalid_json` comes back and
 * the caller sends the human to the file.
 *
 * `env` holds variable *names*, emitted as `${NAME}` the way `buildSeatMcpConfig` already does, so
 * a secret is resolved by the launching process and never rests in a file we wrote.
 */

/** A server as the form collects it, before it becomes a config entry. */
export type McpServerDraft = {
  name: string
  command: string
  /** Whitespace-separated on the way in; stored as the array the format wants. */
  args: string[]
  /** Variable names only — never values. */
  env: string[]
}

export type McpConfigWriteResult =
  | { ok: true; content: string; replaced: boolean }
  | { ok: false; reason: 'invalid_json' | 'not_an_object' | 'invalid_name' }

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Two spaces and a trailing newline — what `MCP_STARTER_CONFIG` writes, so a diff stays small. */
function serialize(config: unknown): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function parseMcpServerArgs(input: string): string[] {
  return input.split(/\s+/).filter(Boolean)
}

export function parseMcpServerEnvNames(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean)
}

export function isValidMcpServerName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/**
 * Merges `draft` into `content` under `mcpServers`.
 *
 * `content` null or blank is the missing-file case and yields a fresh config — the caller has
 * already decided it may create one.
 */
export function upsertMcpServer(
  content: string | null,
  draft: McpServerDraft
): McpConfigWriteResult {
  if (!isValidMcpServerName(draft.name)) {
    return { ok: false, reason: 'invalid_name' }
  }

  let config: Record<string, unknown>
  if (content === null || content.trim() === '') {
    config = {}
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return { ok: false, reason: 'invalid_json' }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'not_an_object' }
    }
    config = { ...(parsed as Record<string, unknown>) }
  }

  const existingServers = config.mcpServers
  // A malformed `mcpServers` is still someone's file; replacing it silently would drop servers.
  if (
    existingServers !== undefined &&
    (existingServers === null ||
      typeof existingServers !== 'object' ||
      Array.isArray(existingServers))
  ) {
    return { ok: false, reason: 'not_an_object' }
  }

  const servers = { ...(existingServers as Record<string, unknown> | undefined) }
  const replaced = Object.hasOwn(servers, draft.name)
  servers[draft.name] = {
    command: draft.command,
    args: [...draft.args],
    ...(draft.env.length > 0
      ? { env: Object.fromEntries(draft.env.map((name) => [name, `\${${name}}`])) }
      : {})
  }

  return { ok: true, content: serialize({ ...config, mcpServers: servers }), replaced }
}
