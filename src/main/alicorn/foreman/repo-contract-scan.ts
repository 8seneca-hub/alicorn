import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ContractEntry, ContractGap } from './contract-registry'
import { extractOpenApiContracts } from './openapi-contract-extraction'
import { extractTypeScriptContracts } from './typescript-contract-extraction'

/**
 * Finds a repo's interface documents and extracts them, or says what would have to be generated.
 *
 * The second half is the point. PROJECT-BRIEF §12 records that extraction "degrades to agent
 * assertion in repos without schemas" and that generating one may have to be a precondition. A scan
 * that finds nothing and returns an empty registry reads as *this repo has no interfaces*; a scan
 * that returns a gap reads as *nobody could extract them, and here is the fix*. Only the second is
 * true.
 */

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.foreman',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.turbo',
  '.venv'
])

const SCAN_DEPTH_MAX = 4
const SCAN_FILES_MAX = 4000

const OPENAPI_BASENAME = /^(openapi|swagger)\.(json|ya?ml)$/i
const OPENAPI_SUFFIX = /\.(openapi|swagger)\.(json|ya?ml)$/i
const OPENAPI_DIRECTORY = /^(openapi|swagger)$/i
const OPENAPI_EXTENSION = /^\.(json|ya?ml)$/i

const CONTRACT_BASENAME = /^(contract|contracts|api-types|api-contract|shared-types)\.(d\.)?ts$/i
const CONTRACT_DIRECTORY = /^contracts?$/i

/** Recorded posix-style whatever the host separator is: the path is read by an agent, not a shell. */
function repoRelative(repoPath: string, filePath: string): string {
  return relative(repoPath, filePath).split(sep).join('/')
}

export type ContractSource = { path: string; kind: 'openapi' | 'typescript' }

function classify(parentName: string, fileName: string): ContractSource['kind'] | null {
  if (OPENAPI_BASENAME.test(fileName) || OPENAPI_SUFFIX.test(fileName)) {
    return 'openapi'
  }
  if (OPENAPI_DIRECTORY.test(parentName) && OPENAPI_EXTENSION.test(extname(fileName))) {
    return 'openapi'
  }
  if (CONTRACT_BASENAME.test(fileName)) {
    return 'typescript'
  }
  if (CONTRACT_DIRECTORY.test(parentName) && /\.(d\.)?ts$/i.test(fileName)) {
    return 'typescript'
  }
  return null
}

/**
 * A depth- and count-bounded walk for the two file shapes the extractors understand.
 *
 * Bounded rather than exhaustive because this runs on the run-start path: a monorepo with a hundred
 * thousand files must cost the run a directory listing, not a minute. An unreadable directory is
 * skipped — a permission error in one corner is not a reason to have no registry.
 */
export async function findContractSources(
  repoPath: string,
  limits: { depth?: number; files?: number } = {}
): Promise<ContractSource[]> {
  const maxDepth = limits.depth ?? SCAN_DEPTH_MAX
  const maxFiles = limits.files ?? SCAN_FILES_MAX
  const found: ContractSource[] = []
  let visited = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited >= maxFiles) {
      return
    }
    let dirents: Dirent<string>[]
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    const parentName = basename(directory)
    for (const dirent of dirents) {
      if (visited >= maxFiles) {
        return
      }
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(dirent.name)) {
          await walk(join(directory, dirent.name), depth + 1)
        }
        continue
      }
      visited++
      const kind = classify(parentName, dirent.name)
      if (kind) {
        found.push({ path: join(directory, dirent.name), kind })
      }
    }
  }

  await walk(repoPath, 0)
  return found.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

/** JSON first, YAML second; a document that parses as neither is not a document we can extract. */
function parseDocument(text: string, path: string): unknown {
  if (extname(path).toLowerCase() === '.json') {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }
  try {
    return parseYaml(text) as unknown
  } catch {
    return null
  }
}

export type RepoContractScan = {
  /** The label every row of this scan carries; also how a stale gap is cleared. */
  repo: string
  entries: ContractEntry[]
  /** Empty when extraction worked; one gap when it could not, naming what to generate. */
  gaps: ContractGap[]
  /** Documents read, for the log line — a scan that found nothing says so out loud. */
  sources: ContractSource[]
  /** Operations or declarations left out at an extractor's ceiling. */
  omitted: number
}

function noSchemaGap(repo: string): ContractGap {
  return {
    repo,
    missing: 'no OpenAPI document and no shared contract types found',
    generate:
      'an OpenAPI document (openapi.yaml or openapi.json) for the HTTP surface, or exported types under contracts/ — until one exists every entry for this repo is agent-declared and only as good as the model’s word'
  }
}

function emptySchemaGap(repo: string, sources: readonly ContractSource[]): ContractGap {
  return {
    repo,
    missing: `${sources.map((source) => source.path).join(', ')} declares no operation or exported type`,
    generate:
      'paths in the OpenAPI document, or exported type declarations in the contract file — the document exists but describes no interface'
  }
}

/**
 * Scans one repo and returns entries, or the gap that explains their absence.
 *
 * `repo` labels every row; it defaults to the directory name so a multi-repo registry stays
 * readable, and reads as `—` on a single-repo run when the caller passes an empty string.
 */
export async function scanRepoContracts(
  repoPath: string,
  options: { repo?: string; depth?: number; files?: number } = {}
): Promise<RepoContractScan> {
  const repo = options.repo ?? basename(repoPath)
  const sources = await findContractSources(repoPath, {
    ...(options.depth === undefined ? {} : { depth: options.depth }),
    ...(options.files === undefined ? {} : { files: options.files })
  })
  if (sources.length === 0) {
    return { repo, entries: [], gaps: [noSchemaGap(repo)], sources, omitted: 0 }
  }

  const entries: ContractEntry[] = []
  let omitted = 0
  const read: ContractSource[] = []

  for (const source of sources) {
    let text: string
    try {
      if ((await stat(source.path)).size > 4 * 1024 * 1024) {
        omitted++
        continue
      }
      text = await readFile(source.path, 'utf8')
    } catch {
      continue
    }
    read.push(source)
    const cited = repoRelative(repoPath, source.path)
    if (source.kind === 'openapi') {
      const document = parseDocument(text, source.path)
      const extracted = extractOpenApiContracts(document, { documentPath: cited, repo })
      entries.push(...extracted.entries)
      omitted += extracted.omitted
      continue
    }
    const extracted = extractTypeScriptContracts(text, { sourcePath: cited, repo })
    entries.push(...extracted.entries)
    omitted += extracted.omitted
  }

  return {
    repo,
    entries,
    gaps: entries.length === 0 ? [emptySchemaGap(repo, read.length > 0 ? read : sources)] : [],
    sources,
    omitted
  }
}
