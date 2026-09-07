import { isAbsolute, relative, resolve } from 'node:path'
import { LEAD_DISALLOWED_TOOLS } from './lead-launch-options'

// One list of write tools, not two: a launch flag and a hook that disagree are a guard rail that
// lies. The *read* half below is this file's own, because no launch flag expresses it — a lead may
// read its own journal and nothing else in the worktree.
const WRITE_TOOLS = new Set<string>(LEAD_DISALLOWED_TOOLS)
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
// These search a tree rather than naming a file, so an absent path means the agent's cwd — the
// worktree root, which is the whole implementation.
const TREE_READ_TOOLS = new Set(['Grep', 'Glob'])
const PATH_KEYS = ['file_path', 'filePath', 'path'] as const

export type LeadToolDecision = { decision: 'block'; reason: string }

export type LeadToolUse = {
  toolName: string
  /** Path the tool is about to touch, when it names one. Relative paths resolve to the worktree. */
  path?: string | undefined
  worktreePath: string
}

function isOutsideWorktree(path: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, resolve(worktreePath, path))
  return rel.startsWith('..') || isAbsolute(rel)
}

function isJournalPath(path: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, resolve(worktreePath, path))
  return rel === '.foreman' || rel.startsWith('.foreman/') || rel.startsWith('.foreman\\')
}

/**
 * Returns a block decision, or null to allow.
 *
 * A read with no path is allowed: refusing what cannot be located would block the lead's own
 * journal reads on any tool shape we have not anticipated, and the write restriction — the one that
 * actually keeps implementation out of the lead — does not depend on a path at all.
 */
export function evaluateLeadToolUse(use: LeadToolUse): LeadToolDecision | null {
  if (WRITE_TOOLS.has(use.toolName)) {
    return {
      decision: 'block',
      reason:
        'The lead writes no code. Dispatch a worker for this change, and record the decision in the journal.'
    }
  }
  if (!READ_TOOLS.has(use.toolName) || !use.path) {
    return null
  }
  if (isOutsideWorktree(use.path, use.worktreePath) || isJournalPath(use.path, use.worktreePath)) {
    return null
  }
  return {
    decision: 'block',
    reason:
      'The lead reads no implementation. Work from the reports and the journal under .foreman/; if you need more, dispatch a worker to look and report back.'
  }
}

function readPath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== 'object' || toolInput === null) {
    return undefined
  }
  const record = toolInput as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

/**
 * The `PreToolUse` payload as a policy question. Separate from the decision so the payload shape —
 * which is the agent's, not ours — is pinned by its own tests.
 */
export function leadToolUseFromPreToolUsePayload(
  payload: Record<string, unknown>,
  worktreePath: string
): LeadToolUse | null {
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : ''
  if (!toolName) {
    return null
  }
  const path = readPath(payload.tool_input) ?? (TREE_READ_TOOLS.has(toolName) ? '.' : undefined)
  return { toolName, ...(path ? { path } : {}), worktreePath }
}
