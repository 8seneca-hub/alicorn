import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ContractEntry, ContractGap } from './contract-registry'
import { extractOpenApiContracts } from './openapi-contract-extraction'
import { extractTypeScriptContracts } from './typescript-contract-extraction'
import { findContractSources, repoRelative, type ContractSource } from './contract-source-scan'

export { findContractSources }
export type { ContractSource }

/**
 * Finds a repo's interface documents and extracts them, or says what would have to be generated.
 *
 * The second half is the point. PROJECT-BRIEF §12 records that extraction "degrades to agent
 * assertion in repos without schemas" and that generating one may have to be a precondition. A scan
 * that finds nothing and returns an empty registry reads as *this repo has no interfaces*; a scan
 * that returns a gap reads as *nobody could extract them, and here is the fix*. Only the second is
 * true.
 */

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
