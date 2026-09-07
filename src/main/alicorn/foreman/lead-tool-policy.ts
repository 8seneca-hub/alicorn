import { relative, isAbsolute } from 'node:path'
import { LEAD_DISALLOWED_TOOLS } from './lead-launch-options'

// One list of write tools, not two: a launch flag and a hook that disagree are a guard rail that
// lies. The *read* half below is this file's own, because no launch flag expresses it — a lead may
// read its own journal and nothing else in the worktree.
const WRITE_TOOLS = new Set<string>(LEAD_DISALLOWED_TOOLS)
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])

export type LeadToolDecision = { decision: 'block'; reason: string }

export type LeadToolUse = {
  toolName: string
  /** Absolute path the tool is about to touch, when it names one. */
  path?: string | undefined
  worktreePath: string
}

function isInsideWorktree(path: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isJournalPath(path: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, path)
  return rel === '.foreman' || rel.startsWith(`.foreman/`) || rel.startsWith(`.foreman\\`)
}

/**
 * Returns a block decision, or null to allow.
 *
 * A read with no path is allowed: refusing what cannot be located would block the lead's own
 * journal reads on any tool shape we have not anticipated, and the write restriction — the one that
 * actually keeps implementation out of the lead — is enforced at launch regardless.
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
  if (!isInsideWorktree(use.path, use.worktreePath) || isJournalPath(use.path, use.worktreePath)) {
    return null
  }
  return {
    decision: 'block',
    reason:
      'The lead reads no implementation. Work from the reports and the journal under .foreman/; if you need more, dispatch a worker to look and report back.'
  }
}
