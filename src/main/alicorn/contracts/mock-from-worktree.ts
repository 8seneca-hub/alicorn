import { readFile, stat } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findContractSources } from '../foreman/contract-source-scan'
import { findOpenApiMockTarget } from './openapi-mock-lookup'
import { generateMock } from './generate-mock'

/** Same 4 MB ceiling `scanRepoContracts` uses; a document past it is not a contract document. */
const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024

export type WorktreeMock = {
  /** Repo-relative document the schema came from, plus the pointer inside it. */
  document: string
  source: string
  value: unknown
}

function parseDocument(text: string, path: string): unknown {
  try {
    return path.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
  } catch {
    return null
  }
}

/**
 * Generates a mock for a named contract by finding it in the worktree's own OpenAPI documents.
 *
 * TypeScript-extracted contracts are deliberately not covered: their registry shape is a
 * declaration, not a schema, and inventing a value from a type would be a second, worse extractor.
 */
export async function mockContractFromWorktree(
  repoPath: string,
  name: string
): Promise<WorktreeMock | null> {
  const sources = await findContractSources(repoPath)
  for (const source of sources) {
    if (source.kind !== 'openapi') {
      continue
    }
    let text: string
    try {
      if ((await stat(source.path)).size > DOCUMENT_MAX_BYTES) {
        continue
      }
      text = await readFile(source.path, 'utf8')
    } catch {
      continue
    }
    const document = parseDocument(text, source.path)
    const target = findOpenApiMockTarget(document, name)
    if (!target) {
      continue
    }
    return {
      document: relative(repoPath, source.path).split(sep).join('/'),
      source: target.source,
      value: generateMock(target.schema, { root: document })
    }
  }
  return null
}
