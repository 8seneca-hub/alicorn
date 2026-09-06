import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeDiffCoverage, normalizeLcovPath } from './diff-coverage'

describe('computeDiffCoverage', () => {
  it('computes total/covered/ratio and a per-file breakdown', () => {
    const added = new Map([
      ['src/a.ts', new Set([11, 12])],
      ['src/b.ts', new Set([6, 7, 8])]
    ])
    const covered = new Map([
      ['src/a.ts', new Set([11])],
      ['src/b.ts', new Set([6, 7])]
    ])

    const result = computeDiffCoverage(added, covered)

    expect(result).toEqual({
      total: 5,
      covered: 3,
      ratio: 0.6,
      perFile: [
        { path: 'src/a.ts', total: 2, covered: 1 },
        { path: 'src/b.ts', total: 3, covered: 2 }
      ]
    })
  })

  it('treats an empty diff as trivially covered', () => {
    const result = computeDiffCoverage(new Map(), new Map())

    expect(result).toEqual({ total: 0, covered: 0, ratio: 1, perFile: [] })
  })

  it('normalises an absolute lcov path against the worktree path', () => {
    const added = new Map([['src/a.ts', new Set([11, 12])]])
    const covered = new Map([['/repo/src/a.ts', new Set([11])]])

    const result = computeDiffCoverage(added, covered, {
      normalize: (path) => normalizeLcovPath(path, '/repo')
    })

    expect(result).toEqual({
      total: 2,
      covered: 1,
      ratio: 0.5,
      perFile: [{ path: 'src/a.ts', total: 2, covered: 1 }]
    })
  })
})

describe('normalizeLcovPath', () => {
  it('normalises a Windows-style relative() result to forward slashes', () => {
    const result = normalizeLcovPath('C:\\repo\\src\\a.ts', 'C:\\repo', win32)

    expect(result).toBe('src/a.ts')
  })
})
