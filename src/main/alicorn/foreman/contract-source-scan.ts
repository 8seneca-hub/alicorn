import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'

/**
 * Finds the documents in a repo that describe its interfaces — OpenAPI documents and shared
 * contract type declarations.
 *
 * Split out from the extraction that follows it so a caller that only needs to *locate* the
 * documents (the `contracts mock` CLI) does not pull the TypeScript compiler API into its module
 * graph along with them.
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
export function repoRelative(repoPath: string, filePath: string): string {
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
