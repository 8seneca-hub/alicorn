import type { QaToolUse } from './qa-tool-policy'

/** Path arguments across the file tools we host; a rename on either side surfaces here. */
const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath'] as const
/** A search pattern is a path when it names one — `../src/**` walks out of the tests directory. */
const PATTERN_KEYS = ['pattern', 'glob'] as const
/** Search a tree rather than name a file, so an absent path means the workspace root. */
const TREE_TOOLS = new Set(['Grep', 'Glob', 'LS'])
const COMMAND_TOOLS = new Set(['Bash', 'BashOutput'])

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The `PreToolUse` payload as a policy question, kept apart from the decision so the payload
 * shape — the agent's, not ours — is pinned by its own tests.
 *
 * A tool that names no path is allowed through: the sandbox is about what QA reads, and refusing
 * `TodoWrite` would make the control look like a permission mode. What that concedes is a file
 * tool we have not anticipated, whose path key is not in the list above.
 */
export function qaToolUseFromPreToolUsePayload(
  payload: Record<string, unknown>,
  workspacePath: string
): QaToolUse | null {
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : ''
  if (!toolName) {
    return null
  }
  const input =
    typeof payload.tool_input === 'object' && payload.tool_input !== null
      ? (payload.tool_input as Record<string, unknown>)
      : {}
  const paths: string[] = []
  for (const key of PATH_KEYS) {
    const value = readString(input, key)
    if (value) {
      paths.push(value)
    }
  }
  for (const key of PATTERN_KEYS) {
    const value = readString(input, key)
    if (value && (value.includes('/') || value.includes('\\'))) {
      paths.push(value)
    }
  }
  if (!paths.length && TREE_TOOLS.has(toolName)) {
    paths.push('.')
  }
  const command = COMMAND_TOOLS.has(toolName) ? readString(input, 'command') : undefined
  return { toolName, paths, ...(command ? { command } : {}), workspacePath }
}
