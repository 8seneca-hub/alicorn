import { describe, expect, it } from 'vitest'
import type { ForemanReport } from '../../../shared/alicorn/foreman-report'
import {
  CONTRACT_ENTRY_MAX_CHARS,
  clampShape,
  clearContractGap,
  contractEntriesFromReport,
  emptyContractRegistry,
  isContractRegistryEmpty,
  mergeContractEntries,
  mergeContractGaps,
  type ContractEntry
} from './contract-registry'

function entry(overrides: Partial<ContractEntry> = {}): ContractEntry {
  return {
    repo: '',
    kind: 'endpoint',
    name: 'POST /refunds/partial',
    shape: 'body {amount: integer} → 201 Refund',
    provenance: 'extracted',
    source: 'openapi.yaml#/paths/~1refunds~1partial/post',
    breaking: false,
    ...overrides
  }
}

function report(overrides: Partial<ForemanReport> = {}): ForemanReport {
  return {
    status: 'done',
    summary: 'Added the endpoint.',
    changes: [],
    interface_delta: [],
    verification: { command: 'pnpm test', result: 'passed', evidence: 'green' },
    open_questions: [],
    artifacts: [],
    cost: { tokens_in: null, tokens_out: null },
    ...overrides
  }
}

describe('mergeContractEntries', () => {
  it('adds a new entry and reports it', () => {
    const registry = emptyContractRegistry()
    expect(mergeContractEntries(registry, [entry()])).toEqual({
      added: 1,
      replaced: 0,
      refused: 0
    })
    expect(registry.entries).toHaveLength(1)
  })

  // The epistemic rule: a schema outranks a model's word, and the reverse is never true.
  it('lets an extracted entry replace a declared one of the same name', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry({ provenance: 'declared', source: 'node 2' })])
    mergeContractEntries(registry, [entry({ provenance: 'extracted', shape: 'the real one' })])
    expect(registry.entries).toHaveLength(1)
    expect(registry.entries[0]).toMatchObject({ provenance: 'extracted', shape: 'the real one' })
  })

  it('refuses to let a declared entry overwrite an extracted one', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry()])
    const result = mergeContractEntries(registry, [
      entry({ provenance: 'declared', shape: 'what the model thinks', source: 'node 2' })
    ])
    expect(result).toEqual({ added: 0, replaced: 0, refused: 0 })
    expect(registry.entries[0]).toMatchObject({
      provenance: 'extracted',
      shape: 'body {amount: integer} → 201 Refund'
    })
  })

  it('treats repo + name as the identity, so two repos may own the same path', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry({ repo: 'api' }), entry({ repo: 'gateway' })])
    expect(registry.entries).toHaveLength(2)
  })

  it('lets a re-scan update an entry it already extracted', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry()])
    mergeContractEntries(registry, [entry({ shape: 'body {amount: integer, currency: string}' })])
    expect(registry.entries).toHaveLength(1)
    expect(registry.entries[0]?.shape).toBe('body {amount: integer, currency: string}')
  })

  // Refused at the door, not dropped at render: the journal is read-modify-write, so a render-time
  // drop is a delete from disk.
  it('refuses past the ceiling and keeps what it already had', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry({ name: 'A' }), entry({ name: 'B' })], 2)
    const result = mergeContractEntries(registry, [entry({ name: 'C' })], 2)
    expect(result.refused).toBe(1)
    expect(registry.entries.map((item) => item.name)).toEqual(['A', 'B'])
  })

  it('clamps a shape that overruns the per-entry ceiling', () => {
    const registry = emptyContractRegistry()
    mergeContractEntries(registry, [entry({ shape: 'x'.repeat(CONTRACT_ENTRY_MAX_CHARS * 2) })])
    expect(registry.entries[0]?.shape).toHaveLength(CONTRACT_ENTRY_MAX_CHARS)
    expect(registry.entries[0]?.shape.endsWith('…')).toBe(true)
  })
})

describe('clampShape', () => {
  it('collapses whitespace so a multi-line declaration costs one line', () => {
    expect(clampShape('interface A {\n  b: string\n}')).toBe('interface A { b: string }')
  })
})

describe('mergeContractGaps', () => {
  it('keeps one gap per repo and updates it when the finding changes', () => {
    const registry = emptyContractRegistry()
    mergeContractGaps(registry, [{ repo: 'api', missing: 'no OpenAPI', generate: 'one' }])
    mergeContractGaps(registry, [{ repo: 'api', missing: 'no OpenAPI', generate: 'one' }])
    expect(registry.gaps).toHaveLength(1)
    mergeContractGaps(registry, [{ repo: 'api', missing: 'empty document', generate: 'paths' }])
    expect(registry.gaps).toHaveLength(1)
    expect(registry.gaps[0]?.missing).toBe('empty document')
  })

  it('clears a repo gap once something was extracted from it', () => {
    const registry = emptyContractRegistry()
    mergeContractGaps(registry, [{ repo: 'api', missing: 'no OpenAPI', generate: 'one' }])
    clearContractGap(registry, 'api')
    expect(registry.gaps).toEqual([])
  })
})

describe('contractEntriesFromReport', () => {
  // The fallback has to be visibly the fallback; this is the field the rendered column reads.
  it('marks every interface delta as agent-declared and cites the node', () => {
    const entries = contractEntriesFromReport(
      '3',
      report({
        interface_delta: [
          { kind: 'endpoint', name: 'POST /refunds', shape: '{amount: number}', breaking: true }
        ]
      })
    )
    expect(entries).toEqual([
      {
        repo: '',
        kind: 'endpoint',
        name: 'POST /refunds',
        shape: '{amount: number}',
        provenance: 'declared',
        source: 'node 3',
        breaking: true
      }
    ])
  })

  it('returns nothing for a report that declared no interface', () => {
    expect(contractEntriesFromReport('1', report())).toEqual([])
  })
})

describe('isContractRegistryEmpty', () => {
  it('is true only when there is no entry, no gap and no prose', () => {
    expect(isContractRegistryEmpty(emptyContractRegistry())).toBe(true)
    expect(isContractRegistryEmpty({ entries: [], gaps: [], notes: 'hi' })).toBe(false)
    expect(
      isContractRegistryEmpty({
        entries: [],
        gaps: [{ repo: 'a', missing: 'b', generate: 'c' }],
        notes: ''
      })
    ).toBe(false)
  })
})
