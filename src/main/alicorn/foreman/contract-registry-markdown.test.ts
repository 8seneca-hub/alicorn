import { describe, expect, it } from 'vitest'
import { emptyContractRegistry, type ContractRegistry } from './contract-registry'
import { parseContractRegistry, renderContractRegistry } from './contract-registry-markdown'

function registry(overrides: Partial<ContractRegistry> = {}): ContractRegistry {
  return {
    entries: [
      {
        repo: 'api',
        kind: 'endpoint',
        name: 'POST /refunds/partial',
        shape: 'body {amount: integer} → 201 Refund, 422 Problem',
        provenance: 'extracted',
        source: 'openapi.yaml#/paths/~1refunds~1partial/post',
        breaking: false
      },
      {
        repo: 'ui',
        kind: 'type',
        name: 'RefundState',
        shape: "type RefundState = 'pending' | 'settled'",
        provenance: 'declared',
        source: 'node 3',
        breaking: true
      }
    ],
    gaps: [
      {
        repo: 'ui',
        missing: 'no OpenAPI document and no shared contract types found',
        generate: 'an OpenAPI document, or exported types under contracts/'
      }
    ],
    notes: 'The lead wrote this by hand.',
    ...overrides
  }
}

describe('renderContractRegistry / parseContractRegistry', () => {
  it('round-trips entries, gaps and hand-written prose', () => {
    const original = registry()
    expect(parseContractRegistry(renderContractRegistry(original))).toEqual(original)
  })

  // A union type is the shape most likely to carry a pipe, and an unescaped one shifts every
  // later column — the reader would read the source as the provenance.
  it('round-trips a shape containing table pipes', () => {
    const piped = registry({ gaps: [], notes: '' })
    expect(parseContractRegistry(renderContractRegistry(piped))).toEqual(piped)
    expect(renderContractRegistry(piped)).toContain("'pending' \\| 'settled'")
  })

  // The design point: a reader who cannot tell an assertion from a schema will trust the wrong one.
  it('marks an agent-declared entry visibly and an extracted one plainly', () => {
    const rendered = renderContractRegistry(registry())
    expect(rendered).toContain('⚠ agent-declared')
    expect(rendered).toMatch(/\| extracted \|/)
  })

  it('renders the schema-generation precondition under its own heading', () => {
    const rendered = renderContractRegistry(registry())
    expect(rendered).toContain('### Schema generation required')
    expect(rendered).toContain('no OpenAPI document and no shared contract types found')
  })

  it('renders an untouched registry as the journal dialect’s empty cell', () => {
    expect(renderContractRegistry(emptyContractRegistry())).toBe('—')
    expect(parseContractRegistry('—')).toEqual(emptyContractRegistry())
    expect(parseContractRegistry('')).toEqual(emptyContractRegistry())
  })

  // Journals written before CR1 carry prose here, and `updateRunJournal` is read-modify-write: text
  // the parser cannot see is text the next coordinator write deletes.
  it('reads a pre-CR1 section of free prose into notes without losing a word', () => {
    const prose = 'POST /refunds/partial { amount: cents }\nGET /refunds/{id}'
    const parsed = parseContractRegistry(prose)
    expect(parsed).toEqual({ entries: [], gaps: [], notes: prose })
    expect(renderContractRegistry(parsed)).toBe(prose)
  })

  it('defaults an unreadable provenance cell to declared rather than extracted', () => {
    const body = [
      '### Interfaces',
      '| Repo | Kind | Name | Shape | Provenance | Source | Breaking? |',
      '|---|---|---|---|---|---|---|',
      '| — | endpoint | GET /x | — | who knows | — | no |'
    ].join('\n')
    expect(parseContractRegistry(body).entries[0]?.provenance).toBe('declared')
  })
})
