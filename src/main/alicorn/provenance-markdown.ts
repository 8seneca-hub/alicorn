import type { ProvenanceReport, StepOutcomeRecord } from '../../shared/alicorn/ledger'

// A stable fence so a re-run replaces its own section rather than appending a
// second one, and so a human editing the body around it is never clobbered.
const START = '<!-- alicorn:provenance:start -->'
const END = '<!-- alicorn:provenance:end -->'
const PROVENANCE_BLOCK = /<!-- alicorn:provenance:start -->[\s\S]*?<!-- alicorn:provenance:end -->/g

const MAX_REPORT_SUMMARY_CHARS = 200

export type MemberNameLookup = (memberId: string) => string | undefined

function formatSpend(cents: number | null | undefined): string {
  return typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : '—'
}

function firstLine(text: string | undefined): string {
  const line = (text ?? '').split('\n', 1)[0]?.trim() ?? ''
  return line.length > MAX_REPORT_SUMMARY_CHARS
    ? `${line.slice(0, MAX_REPORT_SUMMARY_CHARS - 1)}…`
    : line
}

// The member's name when the directory knows it, else the backend — a PR read
// six months from now should still say who ran the step.
function memberLabel(outcome: StepOutcomeRecord, lookup?: MemberNameLookup): string {
  if (!outcome.memberId) {
    return '—'
  }
  return lookup?.(outcome.memberId) ?? outcome.memberId
}

function renderChecks(report: ProvenanceReport): string[] {
  if (report.verifications.length === 0) {
    return []
  }
  const lines = report.verifications.map((verification) => {
    const icon =
      verification.status === 'passed' ? '✅' : verification.status === 'failed' ? '❌' : '⚪'
    const ratio = verification.detail?.ratio
    const detail =
      typeof ratio === 'number'
        ? ` — ${Math.round(ratio * 100)}% covered`
        : ` — ${verification.status}`
    return `- ${icon} ${verification.name}${detail}${verification.required ? ' (required)' : ''}`
  })
  return ['**Checks**', ...lines, '']
}

function renderExecution(report: ProvenanceReport): string {
  const escalated = report.outcomes.find((outcome) => outcome.escalationOffered)
  if (!escalated) {
    return '**Execution** — single agent throughout.'
  }
  const verdict =
    escalated.escalationAccepted === true
      ? 'accepted'
      : escalated.escalationAccepted === false
        ? 'declined'
        : 'no answer'
  return `**Execution** — escalation to orchestrated offered at ${escalated.stageKey} (${verdict}).`
}

// Why record the bypass rather than stay silent: the reviewer rule being off is
// not the same as no conflict, and a reader of the PR has to be able to tell.
function renderReviewerRule(report: ProvenanceReport, policyEnforced: boolean): string {
  if (report.reviewBackend.bypassed) {
    return "**Reviewer backend rule** — ⚠️ bypassed: the reviewer ran on the author's backend (recorded on the run)."
  }
  return policyEnforced
    ? '**Reviewer backend rule** — enforced; the reviewer ran on a different backend from the author.'
    : '**Reviewer backend rule** — not enforced for this organisation.'
}

export function renderProvenanceMarkdown(
  report: ProvenanceReport,
  opts: { policyEnforced: boolean; memberName?: MemberNameLookup }
): string {
  if (report.outcomes.length === 0) {
    return ''
  }
  const rows = report.outcomes.map(
    (outcome) =>
      `| ${outcome.stageKey} | ${memberLabel(outcome, opts.memberName)} | ${outcome.backend} | ${outcome.executionStrategy} | ${outcome.outcome} | ${outcome.filesModified.length} | ${formatSpend(outcome.spendCents)} |`
  )
  const summaries = report.outcomes
    .map((outcome) => ({ stage: outcome.stageKey, line: firstLine(outcome.reportSummary) }))
    .filter((entry) => entry.line.length > 0)
  const sections = [
    START,
    '## Provenance',
    '',
    `Recorded by Alicorn from the run ledger. ${report.totals.tasks} steps · ${report.totals.dispatches} dispatches · est. spend ${formatSpend(report.totals.spendCents)}.`,
    '',
    '| Step | Member | Backend | Strategy | Outcome | Files | Spend |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...renderChecks(report),
    renderReviewerRule(report, opts.policyEnforced),
    '',
    renderExecution(report),
    ''
  ]
  if (summaries.length > 0) {
    sections.push(
      '**Worker reports**',
      ...summaries.map((entry) => `- ${entry.stage}: ${entry.line}`),
      ''
    )
  }
  if (report.contextCaptures.length > 0) {
    sections.push(
      `**Context captured** for ${report.contextCaptures.length} dispatches (exact prompts are in the ledger).`,
      ''
    )
  }
  sections.push(END)
  return sections.join('\n')
}

export async function composeReviewBody(input: {
  body: string | undefined
  useTemplate: boolean | undefined
  readTemplate: () => Promise<string>
  provenance: string
}): Promise<{ body: string | undefined; useTemplate: boolean | undefined }> {
  if (!input.provenance) {
    return { body: input.body, useTemplate: input.useTemplate }
  }
  const stripped = (input.body ?? '').replace(PROVENANCE_BLOCK, '').trimEnd()
  const base = stripped ? stripped : input.useTemplate ? await input.readTemplate() : ''
  return {
    body: `${base.replace(PROVENANCE_BLOCK, '').trimEnd()}\n\n${input.provenance}\n`,
    // The template is already inlined, so the provider must not re-apply it.
    useTemplate: false
  }
}
