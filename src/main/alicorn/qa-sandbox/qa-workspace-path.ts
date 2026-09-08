import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Where a path a QA tool named actually lands, after `..` and symlinks.
 *
 * `outside` is a denial for QA, not a pass: the sibling of a worktree is usually another checkout
 * of the same repository, which is exactly the implementation the sandbox exists to withhold. The
 * Foreman lead policy makes the opposite call for the opposite reason — see `lead-tool-policy.ts`.
 */
export type QaResolvedPath =
  | { kind: 'inside'; relativePath: string }
  | { kind: 'outside' }
  | { kind: 'unresolvable'; reason: string }

export type QaPathFs = {
  exists: (path: string) => boolean
  realpath: (path: string) => string
}

export const nodeQaPathFs: QaPathFs = {
  exists: (path) => existsSync(path),
  realpath: (path) => realpathSync(path)
}

/**
 * Canonicalises the deepest existing ancestor and re-appends the rest, so a path that does not
 * exist yet — the test file QA is about to write — still has its symlinked parents resolved.
 * Returns null when nothing on the way up exists, which on this host means we are looking at a
 * filesystem we cannot see.
 */
function realpathOfNearestExistingAncestor(path: string, fs: QaPathFs): string | null {
  let current = resolve(path)
  const trailing: string[] = []
  for (;;) {
    if (fs.exists(current)) {
      try {
        return join(fs.realpath(current), ...trailing.toReversed())
      } catch {
        return null
      }
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    trailing.push(current.slice(parent.length).replace(/^[\\/]+/, ''))
    current = parent
  }
}

export function resolveQaPath(
  input: { path: string; workspacePath: string },
  fs: QaPathFs = nodeQaPathFs
): QaResolvedPath {
  // Why the workspace first: an unreadable workspace means this process is on the wrong side of
  // the execution boundary (a WSL or SSH pane whose paths this host cannot see). Guessing there
  // would hand back an allow we cannot stand behind, so it is one loud refusal instead.
  const workspaceReal = realpathOfNearestExistingAncestor(input.workspacePath, fs)
  if (!workspaceReal || !fs.exists(input.workspacePath)) {
    return {
      kind: 'unresolvable',
      reason: `the QA workspace ${input.workspacePath} cannot be resolved on the host evaluating this tool call`
    }
  }
  const absolute = isAbsolute(input.path) ? input.path : resolve(input.workspacePath, input.path)
  const targetReal = realpathOfNearestExistingAncestor(absolute, fs)
  if (!targetReal) {
    return { kind: 'unresolvable', reason: `${input.path} cannot be resolved on this host` }
  }
  const rel = relative(workspaceReal, targetReal)
  if (!rel) {
    return { kind: 'inside', relativePath: '' }
  }
  if (rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith('..\\') || isAbsolute(rel)) {
    return { kind: 'outside' }
  }
  return { kind: 'inside', relativePath: rel }
}
