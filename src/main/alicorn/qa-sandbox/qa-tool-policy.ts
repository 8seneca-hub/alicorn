import { bashCommandPaths } from './qa-bash-command-paths'
import { isQaReadableRelativePath, QA_READABLE_DIRECTORY_SEGMENTS } from './qa-readable-paths'
import { nodeQaPathFs, resolveQaPath, type QaPathFs } from './qa-workspace-path'

export type QaToolDecision = { decision: 'block'; reason: string }

export type QaToolUse = {
  toolName: string
  /** Every path the call names. Relative paths resolve against the workspace. */
  paths: string[]
  /** Shell command line, when the tool runs one. Scanned for paths, never parsed. */
  command?: string | undefined
  workspacePath: string
}

const READABLE = QA_READABLE_DIRECTORY_SEGMENTS.join(', ')

const BLINDFOLD_REASON =
  'QA reads no implementation: this is enforced at the tool boundary, not asked for in the prompt ' +
  `(PROJECT-BRIEF §09). Readable in this workspace: ${READABLE}, files named *.test.* / *.spec.*, ` +
  'and Markdown. Write the test from the acceptance criteria; if the requirement is unclear, ask ' +
  'rather than read.'

function block(detail: string): QaToolDecision {
  return { decision: 'block', reason: `${detail} ${BLINDFOLD_REASON}` }
}

/**
 * Returns a block decision, or null to allow.
 *
 * Denies the *tool call*, not just the read: a `Write` into implementation is out of a QA member's
 * remit for the same reason a `Read` is, and an `Edit` cannot happen without the agent having the
 * file in front of it. One rule covers both and there is no second list to fall out of step.
 */
export function evaluateQaToolUse(
  use: QaToolUse,
  fs: QaPathFs = nodeQaPathFs
): QaToolDecision | null {
  const named = [...use.paths, ...(use.command ? bashCommandPaths(use.command) : [])]
  for (const path of named) {
    const resolved = resolveQaPath({ path, workspacePath: use.workspacePath }, fs)
    if (resolved.kind === 'unresolvable') {
      // Fail closed: an ambiguous path is the one case where allowing turns the sandbox into a
      // claim we cannot support (member-directory.ts makes the same trade for org policy).
      return block(`${use.toolName} was refused because ${resolved.reason}.`)
    }
    if (resolved.kind === 'outside') {
      return block(
        `${use.toolName} names ${path}, which resolves outside the QA workspace — a sibling checkout is still the implementation.`
      )
    }
    if (!isQaReadableRelativePath(resolved.relativePath)) {
      const shown = resolved.relativePath || '.'
      return block(`${use.toolName} names ${path}, which is implementation (${shown}).`)
    }
  }
  return null
}
