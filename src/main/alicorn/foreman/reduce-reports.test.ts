import { describe, expect, it } from 'vitest'
import type { ForemanReport } from '../../../shared/alicorn/foreman-report'
import {
  FOREMAN_WAVE_TABLE_MAX_CHARS,
  reduceReports,
  renderWaveFile,
  reportedFileOverlaps,
  type WaveReportEntry
} from './reduce-reports'

function report(overrides: Partial<ForemanReport> = {}): ForemanReport {
  return {
    status: 'done',
    summary: 'Added the endpoint.',
    changes: [{ path: 'src/api/refunds.ts', kind: 'modified', why: 'the endpoint' }],
    interface_delta: [],
    verification: { command: 'pnpm test', result: 'passed', evidence: '12 passed' },
    open_questions: [],
    artifacts: [],
    cost: { tokens_in: 1000, tokens_out: 200 },
    ...overrides
  }
}

function entry(nodeId: string, overrides: Partial<ForemanReport> = {}): WaveReportEntry {
  return { nodeId, report: report(overrides) }
}

function rowsOf(table: string): string[] {
  return table.split('\n').slice(2)
}

describe('reduceReports', () => {
  it('emits one row per node', () => {
    const reduced = reduceReports([entry('1'), entry('2'), entry('3')])
    expect(rowsOf(reduced.table)).toHaveLength(3)
    expect(reduced.table.split('\n')[0]).toContain('Shared files')
  })

  it('carries what a lead decides on, and counts rather than contents for the rest', () => {
    const reduced = reduceReports([
      entry('2', {
        status: 'blocked',
        summary: 'Could not reach the fixture database.',
        changes: [
          { path: 'a.ts', kind: 'modified', why: 'x' },
          { path: 'b.ts', kind: 'added', why: 'y' }
        ],
        verification: { command: 'pnpm test', result: 'not_run', evidence: 'no db' },
        open_questions: ['which schema?', 'which port?']
      })
    ])
    const row = rowsOf(reduced.table)[0]!
    expect(row).toContain('| 2 |')
    expect(row).toContain('blocked')
    expect(row).toContain('Could not reach the fixture database.')
    expect(row).toContain('| 2 |') // change count
    expect(row).toContain('not_run')
    expect(row).toContain('1000/200')
    // Counts, never the bodies: the paths and the questions themselves stay in the reports.
    expect(row).not.toContain('which schema?')
    expect(row).not.toContain('b.ts')
  })

  // The point of the ticket: two workers touching the same file in one wave, caught before merge.
  it('flags a file two nodes in the wave changed, on both their rows', () => {
    const reduced = reduceReports([
      entry('1', { changes: [{ path: 'src/a.ts', kind: 'modified', why: 'x' }] }),
      entry('2', { changes: [{ path: 'src/a.ts', kind: 'modified', why: 'y' }] }),
      entry('3', { changes: [{ path: 'src/c.ts', kind: 'modified', why: 'z' }] })
    ])
    expect(reduced.overlaps).toEqual([{ path: 'src/a.ts', nodeIds: ['1', '2'] }])
    const rows = rowsOf(reduced.table)
    expect(rows[0]).toContain('⚠ src/a.ts')
    expect(rows[1]).toContain('⚠ src/a.ts')
    expect(rows[2]).not.toContain('⚠')
  })

  it('does not flag a path only one node touched, however many times', () => {
    const reduced = reduceReports([
      entry('1', {
        changes: [
          { path: 'src/a.ts', kind: 'modified', why: 'x' },
          { path: 'src/a.ts', kind: 'modified', why: 'again' }
        ]
      })
    ])
    expect(reduced.overlaps).toEqual([])
  })

  it('totals the wave, counting only the reports that priced themselves', () => {
    const reduced = reduceReports([
      entry('1', { cost: { tokens_in: 100, tokens_out: 10 } }),
      entry('2', { cost: { tokens_in: 50, tokens_out: null } })
    ])
    expect(reduced.totals).toEqual({ tokensIn: 150, tokensOut: 10 })
  })

  it('totals null when no report priced itself, rather than reporting a zero it did not measure', () => {
    const reduced = reduceReports([entry('1', { cost: { tokens_in: null, tokens_out: null } })])
    expect(reduced.totals).toEqual({ tokensIn: null, tokensOut: null })
  })

  it('reduces an empty wave to a header and nothing else', () => {
    const reduced = reduceReports([])
    expect(rowsOf(reduced.table)).toEqual([])
    expect(reduced.overlaps).toEqual([])
  })

  // The reduce step must not become the way unbounded content reaches the lead — that is the whole
  // point of the ticket. A long summary is clamped, not carried.
  it('clamps a summary rather than passing a report body through', () => {
    const long = `${'x'.repeat(590)}.`
    const reduced = reduceReports([entry('1', { summary: long })])
    expect(reduced.table).not.toContain(long)
    expect(reduced.table).toContain('…')
  })

  it('keeps a whole wave of maximal reports under the ceiling', () => {
    const wave = Array.from({ length: 12 }, (_, index) =>
      entry(String(index), {
        summary: `${'x'.repeat(590)}.`,
        changes: Array.from({ length: 200 }, (_, n) => ({
          path: `src/file-${n}.ts`,
          kind: 'modified' as const,
          why: 'y'.repeat(200)
        }))
      })
    )
    expect(reduceReports(wave).table.length).toBeLessThanOrEqual(FOREMAN_WAVE_TABLE_MAX_CHARS)
  })

  it('stops at the ceiling and says how many nodes it dropped', () => {
    const wave = Array.from({ length: 6 }, (_, index) => entry(String(index)))
    const reduced = reduceReports(wave, { maxChars: 400 })
    expect(reduced.table).toContain('further node(s) omitted')
    expect(rowsOf(reduced.table).length).toBeLessThan(6)
  })

  // A pipe in a summary would split the row and shift every later column for the lead reading it.
  it('escapes a pipe inside a cell', () => {
    const reduced = reduceReports([entry('1', { summary: 'parsed a|b syntax' })])
    expect(reduced.table).toContain('a\\|b')
  })
})

describe('reportedFileOverlaps', () => {
  it('orders overlaps by path so two reads of a wave agree', () => {
    const overlaps = reportedFileOverlaps([
      entry('1', {
        changes: [
          { path: 'z.ts', kind: 'modified', why: 'x' },
          { path: 'a.ts', kind: 'modified', why: 'x' }
        ]
      }),
      entry('2', {
        changes: [
          { path: 'a.ts', kind: 'modified', why: 'x' },
          { path: 'z.ts', kind: 'modified', why: 'x' }
        ]
      })
    ])
    expect(overlaps.map((overlap) => overlap.path)).toEqual(['a.ts', 'z.ts'])
  })
})

describe('renderWaveFile', () => {
  it('names the wave, the run and the wave spend, and lists the shared files once', () => {
    const reduced = reduceReports([
      entry('1', { changes: [{ path: 'src/a.ts', kind: 'modified', why: 'x' }] }),
      entry('2', { changes: [{ path: 'src/a.ts', kind: 'modified', why: 'y' }] })
    ])
    const file = renderWaveFile(2, 'run_alc42', reduced)
    expect(file).toContain('# Wave 2 — run_alc42')
    expect(file).toContain('**Wave tokens:** in 2000 / out 400')
    expect(file).toContain('## Files touched by more than one node')
    expect(file).toContain('- `src/a.ts` — nodes 1, 2')
  })

  it('omits the shared-file section when nothing overlapped', () => {
    const file = renderWaveFile(1, 'run_1', reduceReports([entry('1')]))
    expect(file).not.toContain('Files touched by more than one node')
  })
})
