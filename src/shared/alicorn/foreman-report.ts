import { z } from 'zod'

// A lead reads every subagent's report into its own context, so an unbounded report is how an
// orchestrated run runs out of window. The ceiling is enforced, not advised: overflow is written to
// a file and the report carries the path (CLAUDE.md, *Foreman is an add-on*).
export const FOREMAN_REPORT_MAX_TOKENS = 1500
export const FOREMAN_REPORT_MAX_CHARS = FOREMAN_REPORT_MAX_TOKENS * 4

// Entries kept when a report spills: enough to act on, few enough to stay inside the ceiling.
const SPILLED_ENTRY_LIMIT = 5

const SENTENCE_TERMINATOR = /[.!?]/g

// Why counted rather than trusted: "≤ 3 sentences" is the one part of the schema a model reliably
// ignores, and a ten-sentence summary is how a bounded report stops being bounded.
function isAtMostThreeSentences(summary: string): boolean {
  return (summary.match(SENTENCE_TERMINATOR)?.length ?? 0) <= 3
}

export const ForemanReportSchema = z.object({
  status: z.enum(['done', 'blocked', 'needs_decision', 'failed']),
  summary: z
    .string()
    .min(1)
    .max(600)
    .refine(isAtMostThreeSentences, { message: 'summary must be at most three sentences' }),
  changes: z
    .array(
      z.object({
        repo: z.string().optional(),
        path: z.string(),
        kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
        why: z.string().max(200)
      })
    )
    .max(200),
  interface_delta: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string(),
        shape: z.string().max(500),
        breaking: z.boolean()
      })
    )
    .max(50),
  verification: z.object({
    command: z.string().max(500),
    result: z.enum(['passed', 'failed', 'not_run']),
    evidence: z.string().max(500)
  }),
  open_questions: z.array(z.string().max(300)).max(20),
  artifacts: z.array(z.string()).max(50).default([]),
  cost: z.object({
    tokens_in: z.number().int().nonnegative().nullable(),
    tokens_out: z.number().int().nonnegative().nullable()
  })
})

export type ForemanReport = z.infer<typeof ForemanReportSchema>

export type FitResult = { body: string; spilled: boolean; reportPath?: string }

// An oversized body is often oversized *because* it is not a report at all — free text, or JSON cut
// off mid-write. Both must spill rather than throw on the way past the ceiling.
function parseReportBody(body: string): ReturnType<typeof ForemanReportSchema.safeParse> | null {
  try {
    return ForemanReportSchema.safeParse(JSON.parse(body) as unknown)
  } catch {
    return null
  }
}

/**
 * Keeps a report under the ceiling. A report that already fits is returned untouched — spilling a
 * short report would cost the lead a file read for nothing.
 *
 * Over the ceiling, the full body is written out and the returned body keeps what a lead needs to
 * decide (status, summary, verification, cost) with the list fields truncated and the spill path in
 * `artifacts`, so nothing is lost — it is one read away rather than in the window.
 */
export function fitReportBody(
  body: string,
  opts: { writeSpill: (content: string) => string; maxChars?: number }
): FitResult {
  const maxChars = opts.maxChars ?? FOREMAN_REPORT_MAX_CHARS
  if (body.length <= maxChars) {
    return { body, spilled: false }
  }

  const reportPath = opts.writeSpill(body)
  const parsed = parseReportBody(body)
  if (!parsed?.success) {
    // Why still spill: an oversized body that does not parse is exactly the case the ceiling exists
    // for, and the lead is better served by a pointer than by the whole thing.
    return {
      body: JSON.stringify({ status: 'needs_decision', artifacts: [reportPath] }),
      spilled: true,
      reportPath
    }
  }

  const report = parsed.data
  return {
    body: JSON.stringify({
      status: report.status,
      summary: report.summary,
      verification: report.verification,
      cost: report.cost,
      changes: report.changes.slice(0, SPILLED_ENTRY_LIMIT),
      interface_delta: report.interface_delta.slice(0, SPILLED_ENTRY_LIMIT),
      open_questions: report.open_questions.slice(0, SPILLED_ENTRY_LIMIT),
      artifacts: [reportPath]
    }),
    spilled: true,
    reportPath
  }
}
