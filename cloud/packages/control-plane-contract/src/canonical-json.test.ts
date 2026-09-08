import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, canonicalJsonStringify } from './canonical-json.js'

describe('canonicalJsonStringify', () => {
  it('sorts object keys so a re-serialised document signs the same', () => {
    const one = { b: 1, a: { d: 2, c: 3 } }
    const other = JSON.parse(JSON.stringify({ a: { c: 3, d: 2 }, b: 1 })) as unknown
    expect(canonicalJsonStringify(one)).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(canonicalJsonStringify(other)).toBe(canonicalJsonStringify(one))
  })

  it('emits no insignificant whitespace and keeps array order', () => {
    expect(canonicalJsonStringify({ list: [3, 1, 2], s: 'x' })).toBe('{"list":[3,1,2],"s":"x"}')
  })

  it('drops undefined members but never reorders around them', () => {
    expect(canonicalJsonStringify({ b: undefined, a: 1, c: 2 })).toBe('{"a":1,"c":2}')
  })

  it('writes a hole in an array as null rather than dropping it', () => {
    expect(canonicalJsonStringify([1, undefined, 2])).toBe('[1,null,2]')
  })

  it('sorts by UTF-16 code unit, which puts uppercase before lowercase', () => {
    expect(canonicalJsonStringify({ a: 1, B: 2, A: 3 })).toBe('{"A":3,"B":2,"a":1}')
  })

  it('refuses a non-finite number instead of quietly signing null', () => {
    expect(() => canonicalJsonStringify({ ratio: Number.NaN })).toThrow(/non-finite/)
    expect(() => canonicalJsonStringify({ ratio: Number.POSITIVE_INFINITY })).toThrow(/non-finite/)
  })

  it('refuses a bigint and a Date rather than guessing a representation', () => {
    expect(() => canonicalJsonStringify({ n: 1n })).toThrow(/bigint/)
    expect(() => canonicalJsonStringify({ at: new Date(0) })).toThrow(/Date/)
  })

  it('names the path of the offending value', () => {
    expect(() => canonicalJsonStringify({ view: { steps: [{ spend: Number.NaN }] } })).toThrow(
      /view\.steps\.0\.spend/
    )
  })

  it('escapes strings the way JSON does, so the bytes stay valid JSON', () => {
    expect(canonicalJsonStringify({ s: 'a"b\né' })).toBe('{"s":"a\\"b\\né"}')
    expect(new TextDecoder().decode(canonicalJsonBytes({ s: 'é' }))).toBe('{"s":"é"}')
  })
})
