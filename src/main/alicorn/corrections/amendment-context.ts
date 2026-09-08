import {
  RULE_PROPOSAL_EXCERPT_MAX_CHARS,
  RULE_PROPOSAL_FILES_MAX,
  type RuleProposalContext
} from '../../../shared/alicorn/rule-proposals'

// Why 20 and not the contract's 200: the pathspec bounds what `git show` prints, and a 200-file
// pathspec on a big refactor is exactly the unbounded output docs/reference/git-scan-safety.md
// warns about. The full file list still travels on the proposal — only the excerpt is narrowed.
const EXCERPT_PATHSPEC_MAX = 20

/**
 * The amendment a human made, as the proposal's evidence: which commit, which files, and enough
 * of the diff to write a rule from. Never blocks the correction — an unreadable diff returns a
 * context without an excerpt rather than throwing.
 */
export async function buildAmendmentContext(
  exec: (argv: string[]) => Promise<{ stdout: string }>,
  input: { sha?: string; filesModified: string[] }
): Promise<RuleProposalContext> {
  const files = input.filesModified.slice(0, RULE_PROPOSAL_FILES_MAX)
  const context: RuleProposalContext = {}
  if (files.length > 0) {
    context.files = files
  }
  if (!input.sha) {
    return context
  }
  context.sha = input.sha
  const excerpt = await readCommitExcerpt(exec, input.sha, files)
  if (excerpt) {
    context.excerpt = excerpt
  }
  return context
}

async function readCommitExcerpt(
  exec: (argv: string[]) => Promise<{ stdout: string }>,
  sha: string,
  files: string[]
): Promise<string | null> {
  // Git 2.25 baseline: `show`, `--stat`, `--patch`, `--unified` and `core.quotepath` all predate it.
  const argv = [
    '-c',
    'core.quotepath=false',
    'show',
    '--no-color',
    '--stat',
    '--patch',
    '--unified=1',
    sha
  ]
  if (files.length > 0) {
    argv.push('--', ...files.slice(0, EXCERPT_PATHSPEC_MAX))
  }
  try {
    const { stdout } = await exec(argv)
    return truncateExcerpt(stdout)
  } catch {
    // A diff too large for the exec buffer, a sha the host has garbage-collected, an SSH host
    // that dropped: none of these are worth losing the proposal over.
    return null
  }
}

function truncateExcerpt(stdout: string): string | null {
  const text = stdout.trim()
  if (!text) {
    return null
  }
  return text.length <= RULE_PROPOSAL_EXCERPT_MAX_CHARS
    ? text
    : `${text.slice(0, RULE_PROPOSAL_EXCERPT_MAX_CHARS - 1)}…`
}
