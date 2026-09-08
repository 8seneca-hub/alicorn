import { describe, expect, it } from 'vitest'
import { CONTRACT_ENTRY_MAX_CHARS } from './contract-registry'
import {
  TYPESCRIPT_SOURCE_MAX_BYTES,
  extractTypeScriptContracts
} from './typescript-contract-extraction'

const SOURCE = `import type { Money } from './money'

/** Not exported, so not a contract anyone builds against. */
type Internal = { secret: string }

export interface Refund {
  id: string
  amount: Money
  nested: { at: string }
}

export type RefundState =
  | 'pending'
  | 'settled'
  | 'failed'

export enum RefundKind {
  Full = 'full',
  Partial = 'partial'
}

export const REFUND_LIMIT = 100
`

function extract(source = SOURCE) {
  return extractTypeScriptContracts(source, { sourcePath: 'contracts/refunds.ts', repo: 'api' })
}

describe('extractTypeScriptContracts', () => {
  it('takes exported type declarations and leaves the rest alone', () => {
    expect(extract().entries.map((entry) => entry.name)).toEqual([
      'Refund',
      'RefundState',
      'RefundKind'
    ])
  })

  it('captures an interface body whole, nested braces included', () => {
    const refund = extract().entries.find((entry) => entry.name === 'Refund')
    expect(refund?.shape).toBe(
      'interface Refund { id: string amount: Money nested: { at: string } }'
    )
    expect(refund?.kind).toBe('interface')
  })

  it('captures a union alias spread over several lines', () => {
    const state = extract().entries.find((entry) => entry.name === 'RefundState')
    expect(state?.shape).toBe("type RefundState = | 'pending' | 'settled' | 'failed'")
  })

  it('cites the file and line, and marks the entry extracted', () => {
    const kind = extract().entries.find((entry) => entry.name === 'RefundKind')
    expect(kind).toMatchObject({
      provenance: 'extracted',
      repo: 'api',
      source: 'contracts/refunds.ts:17',
      breaking: false
    })
  })

  it('keeps every entry inside the per-entry token ceiling', () => {
    const wide = `export interface Wide {\n${'  field: string\n'.repeat(400)}}\n`
    const entry = extract(wide).entries[0]
    expect(entry?.shape).toHaveLength(CONTRACT_ENTRY_MAX_CHARS)
    expect(entry?.shape.endsWith('…')).toBe(true)
  })

  it('stops at the declaration ceiling and says how many it left out', () => {
    const many = Array.from({ length: 5 }, (_, index) => `export type T${index} = string`).join(
      '\n'
    )
    const extracted = extractTypeScriptContracts(many, {
      sourcePath: 'contracts/api.ts',
      maxDeclarations: 2
    })
    expect(extracted.entries).toHaveLength(2)
    expect(extracted.omitted).toBe(3)
  })

  it('refuses a file over the byte ceiling rather than scanning it', () => {
    const huge = `export type A = string\n`.padEnd(TYPESCRIPT_SOURCE_MAX_BYTES + 1, ' ')
    expect(extractTypeScriptContracts(huge, { sourcePath: 'x.ts' })).toEqual({
      entries: [],
      omitted: 1
    })
  })

  // A truncated file yields no entry rather than one that runs to the end of the source.
  it('skips a declaration whose braces never close', () => {
    expect(extract('export interface Broken {\n  a: string\n').entries).toEqual([])
  })

  it('finds nothing in a file with no exported types, and says so by returning nothing', () => {
    expect(extract('export function go(): void {}\n').entries).toEqual([])
  })
})
