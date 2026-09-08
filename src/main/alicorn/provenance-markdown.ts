import { formatSpendCents, type ProvenanceView } from '../../shared/alicorn/provenance-view'

// A stable fence so a re-run replaces its own section rather than appending a
// second one, and so a human editing the body around it is never clobbered.
const START = '<!-- alicorn:provenance:start -->'
const END = '<!-- alicorn:provenance:end -->'
const PROVENANCE_BLOCK = /<!-- alicorn:provenance:start -->[\s\S]*?<!-- alicorn:provenance:end -->/g

function renderChecks(view: ProvenanceView): string[] {
  if (view.checks.length === 0) {
    return []
  }
  const lines = view.checks.map((check) => {
    const icon = check.status === 'passed' ? '✅' : check.status === 'failed' ? '❌' : '⚪'
    const detail =
      check.ratio === null ? ` — ${check.status}` : ` — ${Math.round(check.ratio * 100)}% covered`
    return `- ${icon} ${check.name}${detail}${check.required ? ' (required)' : ''}`
  })
  return ['**Checks**', ...lines, '']
}

function renderExecution(view: ProvenanceView): string {
  if (!view.escalation.offered) {
    return '**Execution** — single agent throughout.'
  }
  const verdict = view.escalation.verdict === 'unanswered' ? 'no answer' : view.escalation.verdict
  return `**Execution** — escalation to orchestrated offered at ${view.escalation.stageKey} (${verdict}).`
}

// Why record the bypass rather than stay silent: the reviewer rule being off is
// not the same as no conflict, and a reader of the PR has to be able to tell.
function renderReviewerRule(view: ProvenanceView): string {
  if (view.reviewerRule === 'bypassed') {
    return "**Reviewer backend rule** — ⚠️ bypassed: the reviewer ran on the author's backend (recorded on the run)."
  }
  return view.reviewerRule === 'enforced'
    ? '**Reviewer backend rule** — enforced; the reviewer ran on a different backend from the author.'
    : '**Reviewer backend rule** — not enforced for this organisation.'
}

/**
 * The PR-body half of the provenance surface. It takes the same `ProvenanceView` the in-app panel
 * renders — assembling the ledger a second way here is how the two would come to disagree about
 * the same run.
 */
export function renderProvenanceMarkdown(view: ProvenanceView): string {
  if (view.steps.length === 0) {
    return ''
  }
  // The member's name when the directory knows it, else the id — a PR read six months from now
  // should still say who ran the step.
  const rows = view.steps.map(
    (step) =>
      `| ${step.stageKey} | ${step.member ?? '—'} | ${step.backend} | ${step.executionStrategy} | ${step.outcome} | ${step.filesModified} | ${formatSpendCents(step.spendCents)} |`
  )
  const summaries = view.steps.filter((step) => step.reportSummary.length > 0)
  const sections = [
    START,
    '## Provenance',
    '',
    `Recorded by Alicorn from the run ledger. ${view.totals.tasks} steps · ${view.totals.dispatches} dispatches · est. spend ${formatSpendCents(view.totals.spendCents)}.`,
    '',
    '| Step | Member | Backend | Strategy | Outcome | Files | Spend |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...renderChecks(view),
    renderReviewerRule(view),
    '',
    renderExecution(view),
    ''
  ]
  if (summaries.length > 0) {
    sections.push(
      '**Worker reports**',
      ...summaries.map((step) => `- ${step.stageKey}: ${step.reportSummary}`),
      ''
    )
  }
  if (view.contextCaptureCount > 0) {
    sections.push(
      `**Context captured** for ${view.contextCaptureCount} dispatches (exact prompts are in the ledger).`,
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
