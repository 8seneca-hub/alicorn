import { describe, expect, it } from 'vitest'
import { parseLcov } from './lcov-parser'

describe('parseLcov', () => {
  it('maps each SF file to lines with hits > 0, resetting per end_of_record', () => {
    const text = [
      'SF:src/a.ts',
      'DA:11,3',
      'DA:12,0',
      'end_of_record',
      'SF:src/b.ts',
      'DA:6,3',
      'DA:7,3',
      'DA:8,0',
      'end_of_record'
    ].join('\n')

    const covered = parseLcov(text)

    expect(covered.get('src/a.ts')).toEqual(new Set([11]))
    expect(covered.get('src/b.ts')).toEqual(new Set([6, 7]))
  })

  it('ignores DA lines outside any SF block', () => {
    const text = ['DA:1,5', 'SF:src/a.ts', 'end_of_record', 'DA:2,5'].join('\n')

    const covered = parseLcov(text)

    expect(covered.get('src/a.ts')).toEqual(new Set())
  })
})
