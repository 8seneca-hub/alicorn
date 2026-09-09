import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyContractRegistry } from './contract-registry'
import { renderContractRegistry } from './contract-registry-markdown'
import { findContractSources, scanRepoContracts } from './repo-contract-scan'
import { recordContractScan } from './journal-writer'
import type { Journal } from './journal-types'

let repo: string | undefined

afterEach(() => {
  if (repo) {
    rmSync(repo, { recursive: true, force: true })
    repo = undefined
  }
})

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cr1-'))
  repo = root
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents, 'utf8')
  }
  return root
}

const OPENAPI_YAML = `openapi: 3.1.0
paths:
  /refunds:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefundRequest'
      responses:
        '201':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Refund' }
components:
  schemas:
    RefundRequest:
      type: object
      required: [amount]
      properties:
        amount: { type: integer }
    Refund:
      type: object
      properties:
        id: { type: string }
`

function journalWith(): Journal {
  return {
    runId: 'run_1',
    objective: '',
    status: 'running',
    startedAt: '2026-09-08T00:00:00.000Z',
    budgetCents: null,
    spentCents: null,
    decisions: [],
    assumptions: [],
    plan: [],
    waves: [],
    contractRegistry: emptyContractRegistry(),
    team: null,
    log: [],
    notDone: []
  }
}

describe('findContractSources', () => {
  it('finds OpenAPI documents and contract type files, and skips build output', async () => {
    const root = makeRepo({
      'openapi.yaml': OPENAPI_YAML,
      'docs/service.openapi.json': '{}',
      'openapi/billing.yml': 'paths: {}',
      'src/contracts/refunds.ts': 'export type A = string\n',
      'src/api-types.ts': 'export type B = string\n',
      'node_modules/pkg/openapi.yaml': OPENAPI_YAML,
      'dist/openapi.yaml': OPENAPI_YAML,
      'src/unrelated.ts': 'export type C = string\n'
    })
    const found = await findContractSources(root)
    expect(found.map((source) => relative(root, source.path).split(sep).join('/')).sort()).toEqual([
      'docs/service.openapi.json',
      'openapi.yaml',
      'openapi/billing.yml',
      'src/api-types.ts',
      'src/contracts/refunds.ts'
    ])
  })

  it('stops at the depth limit rather than walking a monorepo', async () => {
    const root = makeRepo({ 'a/b/c/d/e/openapi.yaml': OPENAPI_YAML })
    expect(await findContractSources(root, { depth: 2 })).toEqual([])
    expect(await findContractSources(root, { depth: 6 })).toHaveLength(1)
  })
})

describe('scanRepoContracts', () => {
  it('extracts a YAML OpenAPI document into entries that cite it', async () => {
    const root = makeRepo({ 'openapi.yaml': OPENAPI_YAML })
    const scan = await scanRepoContracts(root, { repo: 'api' })
    expect(scan.gaps).toEqual([])
    expect(scan.entries.map((entry) => entry.name).sort()).toEqual([
      'POST /refunds',
      'Refund',
      'RefundRequest'
    ])
    expect(scan.entries[0]).toMatchObject({
      repo: 'api',
      provenance: 'extracted',
      source: 'openapi.yaml#/paths/~1refunds/post'
    })
  })

  it('extracts shared contract types when there is no OpenAPI document', async () => {
    const root = makeRepo({
      'src/contracts/refunds.ts': 'export interface Refund {\n  id: string\n}\n'
    })
    const scan = await scanRepoContracts(root, { repo: 'ui' })
    expect(scan.gaps).toEqual([])
    expect(scan.entries).toHaveLength(1)
    expect(scan.entries[0]).toMatchObject({
      name: 'Refund',
      provenance: 'extracted',
      source: 'src/contracts/refunds.ts:1'
    })
  })

  // The design point: an empty registry reads as "this repo has no interfaces". It never said that.
  it('records what would have to be generated when a repo has no schema at all', async () => {
    const root = makeRepo({ 'src/index.ts': 'export function go(): void {}\n' })
    const scan = await scanRepoContracts(root, { repo: 'billing' })
    expect(scan.entries).toEqual([])
    expect(scan.sources).toEqual([])
    expect(scan.gaps).toHaveLength(1)
    expect(scan.gaps[0]?.repo).toBe('billing')
    expect(scan.gaps[0]?.missing).toContain('no OpenAPI document')
    expect(scan.gaps[0]?.generate).toContain('OpenAPI document')
    expect(scan.gaps[0]?.generate).toContain('agent-declared')
  })

  it('records a gap for a document that exists but describes no interface', async () => {
    const root = makeRepo({ 'openapi.yaml': 'openapi: 3.1.0\npaths: {}\n' })
    const scan = await scanRepoContracts(root, { repo: 'api' })
    expect(scan.entries).toEqual([])
    expect(scan.gaps[0]?.missing).toContain('declares no operation')
  })

  it('survives an unparseable document rather than failing the scan', async () => {
    const root = makeRepo({ 'openapi.json': '{ not json' })
    const scan = await scanRepoContracts(root, { repo: 'api' })
    expect(scan.entries).toEqual([])
    expect(scan.gaps).toHaveLength(1)
  })
})

describe('recordContractScan', () => {
  it('writes extracted entries into the journal registry and logs the count', async () => {
    const root = makeRepo({ 'openapi.yaml': OPENAPI_YAML })
    const journal = journalWith()
    const line = recordContractScan(journal, await scanRepoContracts(root, { repo: '' }))
    expect(journal.contractRegistry.entries).toHaveLength(3)
    expect(journal.contractRegistry.gaps).toEqual([])
    expect(line).toContain('3 interface(s) extracted')
  })

  // A no-schema repo produces a marked, honest section — never an empty one, never a fabricated one.
  it('writes an honest gap section for a repo with no schema', async () => {
    const root = makeRepo({ 'src/index.ts': 'export function go(): void {}\n' })
    const journal = journalWith()
    const line = recordContractScan(journal, await scanRepoContracts(root, { repo: 'billing' }))
    expect(journal.contractRegistry.entries).toEqual([])
    expect(line).toContain('no schema extracted')
    const rendered = renderContractRegistry(journal.contractRegistry)
    expect(rendered).not.toBe('—')
    expect(rendered).toContain('### Schema generation required')
    expect(rendered).toContain('billing')
  })

  it('clears a repo’s gap once a later scan extracts something from it', async () => {
    const empty = makeRepo({ 'src/index.ts': 'export function go(): void {}\n' })
    const journal = journalWith()
    recordContractScan(journal, await scanRepoContracts(empty, { repo: 'api' }))
    expect(journal.contractRegistry.gaps).toHaveLength(1)
    rmSync(empty, { recursive: true, force: true })

    const filled = makeRepo({ 'openapi.yaml': OPENAPI_YAML })
    recordContractScan(journal, await scanRepoContracts(filled, { repo: 'api' }))
    expect(journal.contractRegistry.gaps).toEqual([])
    expect(journal.contractRegistry.entries.length).toBeGreaterThan(0)
  })
})
