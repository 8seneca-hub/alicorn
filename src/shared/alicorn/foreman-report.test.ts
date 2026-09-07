import { describe, expect, it, vi } from 'vitest'
import { FOREMAN_REPORT_MAX_CHARS, ForemanReportSchema, fitReportBody } from './foreman-report'

function report(overrides: Record<string, unknown> = {}) {
  return {
    status: 'done',
    summary: 'Added the parser. Tests pass.',
    changes: [{ path: 'src/a.ts', kind: 'modified', why: 'parse the header' }],
    interface_delta: [],
    verification: { command: 'pnpm test', result: 'passed', evidence: '12 passed' },
    open_questions: [],
    cost: { tokens_in: 100, tokens_out: 200 },
    ...overrides
  }
}

describe('ForemanReportSchema', () => {
  it('accepts the report shape the template asks a subagent for', () => {
    expect(ForemanReportSchema.safeParse(report()).success).toBe(true)
  })

  it('defaults artifacts so a report without one still parses', () => {
    const parsed = ForemanReportSchema.parse(report())
    expect(parsed.artifacts).toEqual([])
  })

  // Why counted rather than trusted: "at most three sentences" is the constraint a model most
  // reliably ignores, and an unbounded summary is how a bounded report stops being bounded.
  it('rejects a four-sentence summary', () => {
    const result = ForemanReportSchema.safeParse(report({ summary: 'One. Two. Three. Four.' }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('three sentences')
  })

  it('accepts exactly three sentences', () => {
    expect(ForemanReportSchema.safeParse(report({ summary: 'One. Two. Three.' })).success).toBe(
      true
    )
  })

  it('accepts a summary with no terminator at all', () => {
    expect(ForemanReportSchema.safeParse(report({ summary: 'Did the thing' })).success).toBe(true)
  })

  it('rejects an empty summary rather than treating it as no news', () => {
    expect(ForemanReportSchema.safeParse(report({ summary: '' })).success).toBe(false)
  })

  it('rejects a status outside the four the lead can act on', () => {
    expect(ForemanReportSchema.safeParse(report({ status: 'in_progress' })).success).toBe(false)
  })

  it('rejects negative token counts', () => {
    expect(
      ForemanReportSchema.safeParse(report({ cost: { tokens_in: -1, tokens_out: 0 } })).success
    ).toBe(false)
  })

  // Backends that do not report usage must still be able to file a report.
  it('accepts null token counts', () => {
    expect(
      ForemanReportSchema.safeParse(report({ cost: { tokens_in: null, tokens_out: null } })).success
    ).toBe(true)
  })
})

describe('fitReportBody', () => {
  it('leaves a report that already fits untouched, without writing a spill', () => {
    const writeSpill = vi.fn(() => '/spill.md')
    const body = JSON.stringify(report())
    expect(fitReportBody(body, { writeSpill })).toEqual({ body, spilled: false })
    expect(writeSpill).not.toHaveBeenCalled()
  })

  it('spills an oversized report and points at it through artifacts', () => {
    const writeSpill = vi.fn(() => '/spill/run-dispatch-report.md')
    const body = JSON.stringify(
      report({
        changes: Array.from({ length: 200 }, (_, i) => ({
          path: `src/file-${i}.ts`,
          kind: 'modified',
          why: 'x'.repeat(200)
        }))
      })
    )
    expect(body.length).toBeGreaterThan(FOREMAN_REPORT_MAX_CHARS)

    const result = fitReportBody(body, { writeSpill })

    expect(result.spilled).toBe(true)
    expect(result.reportPath).toBe('/spill/run-dispatch-report.md')
    expect(writeSpill).toHaveBeenCalledWith(body)
    const fitted = JSON.parse(result.body) as Record<string, unknown>
    expect(fitted.artifacts).toEqual(['/spill/run-dispatch-report.md'])
    expect(result.body.length).toBeLessThan(FOREMAN_REPORT_MAX_CHARS)
  })

  it('keeps what the lead decides on and truncates only the lists', () => {
    const writeSpill = () => '/spill.md'
    const body = JSON.stringify(
      report({
        open_questions: Array.from({ length: 20 }, () => 'q'.repeat(300)),
        changes: Array.from({ length: 200 }, (_, i) => ({
          path: `src/file-${i}.ts`,
          kind: 'modified',
          why: 'x'.repeat(200)
        }))
      })
    )
    const fitted = JSON.parse(fitReportBody(body, { writeSpill }).body) as Record<string, unknown>

    expect(fitted.status).toBe('done')
    expect(fitted.summary).toBe('Added the parser. Tests pass.')
    expect(fitted.verification).toEqual({
      command: 'pnpm test',
      result: 'passed',
      evidence: '12 passed'
    })
    expect(fitted.cost).toEqual({ tokens_in: 100, tokens_out: 200 })
    expect((fitted.changes as unknown[]).length).toBe(5)
    expect((fitted.open_questions as unknown[]).length).toBe(5)
  })

  // An oversized body that is not a valid report is exactly what the ceiling exists for; the lead
  // is better served by a pointer than by the whole thing.
  it('still spills a body that is not a parseable report', () => {
    const writeSpill = vi.fn(() => '/spill.md')
    const result = fitReportBody('x'.repeat(FOREMAN_REPORT_MAX_CHARS + 1), { writeSpill })

    expect(result.spilled).toBe(true)
    expect(writeSpill).toHaveBeenCalled()
    expect(JSON.parse(result.body)).toEqual({
      status: 'needs_decision',
      artifacts: ['/spill.md']
    })
  })

  it('honours an explicit ceiling', () => {
    const writeSpill = vi.fn(() => '/spill.md')
    const body = JSON.stringify(report())
    expect(fitReportBody(body, { writeSpill, maxChars: 10 }).spilled).toBe(true)
  })

  it('treats a body exactly at the ceiling as fitting', () => {
    const writeSpill = vi.fn(() => '/spill.md')
    const body = 'x'.repeat(20)
    expect(fitReportBody(body, { writeSpill, maxChars: 20 }).spilled).toBe(false)
  })
})
