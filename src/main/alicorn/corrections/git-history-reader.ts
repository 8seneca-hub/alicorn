export type CommitSummary = {
  sha: string
  authorTime: number
  subject: string
  body: string
  paths: string[]
}

const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'
const PRETTY_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`

export function createGitHistoryReader(exec: (argv: string[]) => Promise<{ stdout: string }>): {
  commitsSince(sinceIso: string): Promise<CommitSummary[]>
} {
  return {
    async commitsSince(sinceIso: string): Promise<CommitSummary[]> {
      // --since bounds the scan (AGENTS.md git scan safety: never --all).
      const { stdout } = await exec([
        'log',
        `--since=${sinceIso}`,
        '--date=iso-strict',
        `--pretty=format:${PRETTY_FORMAT}`,
        '--name-only'
      ])
      return parseCommitsSinceOutput(stdout)
    }
  }
}

/**
 * `--name-only` appends each commit's changed paths after its formatted record, so a
 * \x1e boundary splits a chunk into [paths of the previous commit][fields of the next] --
 * never a clean per-commit record on its own.
 */
function parseCommitsSinceOutput(stdout: string): CommitSummary[] {
  const chunks = stdout.replace(/\r\n/g, '\n').split(RECORD_SEP)
  const commits: CommitSummary[] = []
  let pendingFields: string | null = chunks[0] ?? null
  for (let index = 1; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const isLastChunk = index === chunks.length - 1
    const split = isLastChunk ? null : splitPathsFromNextFields(chunk)
    if (pendingFields !== null) {
      commits.push(buildCommitSummary(pendingFields, parsePaths(split ? split.pathsText : chunk)))
    }
    pendingFields = split ? split.fieldsText : null
  }
  return commits
}

/** Paths never contain \x1f, so the first one in a shared chunk starts the next record's fields. */
function splitPathsFromNextFields(chunk: string): { pathsText: string; fieldsText: string } | null {
  const fieldSepIndex = chunk.indexOf(FIELD_SEP)
  if (fieldSepIndex === -1) {
    return null
  }
  const lineStart = chunk.lastIndexOf('\n', fieldSepIndex) + 1
  return { pathsText: chunk.slice(0, lineStart), fieldsText: chunk.slice(lineStart) }
}

function parsePaths(pathsText: string): string[] {
  return pathsText
    .split('\n')
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

function buildCommitSummary(fieldsText: string, paths: string[]): CommitSummary {
  const [sha = '', authorIso = '', subject = '', ...bodyParts] = fieldsText.split(FIELD_SEP)
  return {
    sha,
    authorTime: Date.parse(authorIso),
    subject,
    body: bodyParts.join(FIELD_SEP).replace(/\n$/, ''),
    paths
  }
}
