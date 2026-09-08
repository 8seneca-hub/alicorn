import { describe, expect, it, vi } from 'vitest'
import { composeReviewBody, renderProvenanceMarkdown as renderView } from './provenance-markdown'
import { buildProvenanceView, type MemberNameLookup } from '../../shared/alicorn/provenance-view'
import type { ProvenanceReport, StepOutcomeRecord } from '../../shared/alicorn/ledger'

// The renderer takes the shared projection now; these cases still start from a raw ledger report,
// which is what keeps them a regression guard on the whole path rather than on the formatter alone.
function renderProvenanceMarkdown(
  report: ProvenanceReport,
  opts: { policyEnforced: boolean; memberName?: MemberNameLookup }
): string {
  return renderView(buildProvenanceView(report, opts))
}

function outcome(overrides: Partial<StepOutcomeRecord> = {}): StepOutcomeRecord {
  return {
    id: 'o1',
    tenantId: 'local',
    runId: 'run_1',
    taskId: 't1',
    dispatchId: 'd1',
    backend: 'claude',
    stageKey: 'build',
    executionStrategy: 'single',
    outcome: 'succeeded',
    filesModified: ['a.ts'],
    reviewBackendBypass: false,
    escalationOffered: false,
    escalationAccepted: null,
    spendCents: 61,
    usage: null,
    gateDecision: 'auto',
    gateReason: '',
    gateId: null,
    policyRecommendation: null,
    policyRecommendationReason: null,
    humanGateDecision: null,
    agreedWithPolicy: null,
    recommendationShown: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides
  }
}

function report(overrides: Partial<ProvenanceReport> = {}): ProvenanceReport {
  return {
    repoId: 'r1',
    branch: 'feature/x',
    outcomes: [outcome()],
    verifications: [],
    contextCaptures: [],
    totals: { spendCents: 61, tasks: 1, dispatches: 1 },
    reviewBackend: { enforced: true, bypassed: false },
    ...overrides
  }
}

describe('renderProvenanceMarkdown', () => {
  it('renders nothing when the ledger has no outcomes', () => {
    expect(renderProvenanceMarkdown(report({ outcomes: [] }), { policyEnforced: true })).toBe('')
  })

  it('renders a row per step inside the fence', () => {
    const markdown = renderProvenanceMarkdown(
      report({
        outcomes: [
          outcome({ stageKey: 'build', memberId: 'm1', backend: 'claude', spendCents: 61 }),
          outcome({
            stageKey: 'review',
            memberId: 'm2',
            backend: 'codex',
            filesModified: [],
            spendCents: 21
          })
        ],
        totals: { spendCents: 82, tasks: 2, dispatches: 2 }
      }),
      { policyEnforced: true, memberName: (id) => (id === 'm1' ? 'Developer' : 'Reviewer') }
    )

    expect(markdown).toContain('<!-- alicorn:provenance:start -->')
    expect(markdown).toContain('<!-- alicorn:provenance:end -->')
    expect(markdown).toContain('| build | Developer | claude | single | succeeded | 1 | $0.61 |')
    expect(markdown).toContain('| review | Reviewer | codex | single | succeeded | 0 | $0.21 |')
    expect(markdown).toContain('2 steps · 2 dispatches · est. spend $0.82.')
  })

  it('falls back to the member id when the directory cannot name it', () => {
    const markdown = renderProvenanceMarkdown(report({ outcomes: [outcome({ memberId: 'm9' })] }), {
      policyEnforced: true
    })
    expect(markdown).toContain('| build | m9 |')
  })

  it('shows an em dash for a direct launch and for unknown spend', () => {
    const markdown = renderProvenanceMarkdown(
      report({ outcomes: [outcome({ spendCents: null })] }),
      { policyEnforced: true }
    )
    expect(markdown).toContain('| build | — | claude | single | succeeded | 1 | — |')
  })

  it('renders a passing required check with its ratio', () => {
    const markdown = renderProvenanceMarkdown(
      report({
        verifications: [
          {
            id: 'v1',
            runId: 'run_1',
            taskId: 't1',
            dispatchId: 'd1',
            kind: 'diff_coverage',
            name: 'Diff coverage ≥ 80%',
            required: true,
            status: 'passed',
            detail: { ratio: 0.86 },
            createdAt: '2026-09-06T00:00:00.000Z'
          }
        ]
      }),
      { policyEnforced: true }
    )

    expect(markdown).toContain('- ✅ Diff coverage ≥ 80% — 86% covered (required)')
  })

  it('warns when the reviewer ran on the author backend', () => {
    const markdown = renderProvenanceMarkdown(
      report({ reviewBackend: { enforced: true, bypassed: true } }),
      { policyEnforced: true }
    )
    expect(markdown).toContain('⚠️ bypassed')
  })

  it('says the rule is off rather than implying it passed', () => {
    // Policy off is not the same as no conflict; a reader must be able to tell.
    const markdown = renderProvenanceMarkdown(report(), { policyEnforced: false })
    expect(markdown).toContain('not enforced for this organisation')
  })

  it('reports an escalation offer and its answer', () => {
    const markdown = renderProvenanceMarkdown(
      report({
        outcomes: [outcome({ escalationOffered: true, escalationAccepted: true })]
      }),
      { policyEnforced: true }
    )
    expect(markdown).toContain('escalation to orchestrated offered at build (accepted)')
  })

  it('counts the gate decisions and says whether the human agreed with the policy', () => {
    const markdown = renderProvenanceMarkdown(
      report({
        outcomes: [
          outcome({ id: 'a', stageKey: 'build', gateDecision: 'auto', gateReason: 'auto' }),
          outcome({
            id: 'b',
            stageKey: 'merge',
            gateDecision: 'gate',
            gateReason: 'irreversible',
            gateId: 'g1',
            policyRecommendation: 'gate',
            policyRecommendationReason: 'irreversible',
            humanGateDecision: 'gate',
            agreedWithPolicy: true,
            recommendationShown: false
          })
        ]
      }),
      { policyEnforced: true }
    )

    expect(markdown).toContain('**Gate decisions** — 1 gated, 1 automatic.')
    expect(markdown).toContain(
      '- merge: policy said gate (irreversible), human chose gate — agreed with the policy; recommendation not shown.'
    )
  })

  it('counts a step written before GP1 as unrecorded rather than automatic', () => {
    const markdown = renderProvenanceMarkdown(
      report({ outcomes: [outcome({ gateDecision: '', gateReason: '' })] }),
      { policyEnforced: true }
    )
    expect(markdown).toContain('**Gate decisions** — 0 gated, 0 automatic, 1 unrecorded.')
  })

  it('truncates a long worker report to one line', () => {
    const markdown = renderProvenanceMarkdown(
      report({ outcomes: [outcome({ reportSummary: `${'x'.repeat(400)}\nsecond line` })] }),
      { policyEnforced: true }
    )

    const line = markdown.split('\n').find((entry) => entry.startsWith('- build: '))
    expect(line?.length).toBeLessThan(220)
    expect(markdown).not.toContain('second line')
  })
})

describe('composeReviewBody', () => {
  const readTemplate = vi.fn().mockResolvedValue('## Summary\n\n<!-- describe -->')

  it('leaves the body untouched when there is no provenance', async () => {
    await expect(
      composeReviewBody({
        body: 'hand written',
        useTemplate: true,
        readTemplate,
        provenance: ''
      })
    ).resolves.toEqual({ body: 'hand written', useTemplate: true })
  })

  it('appends provenance and stops the provider re-applying the template', async () => {
    const composed = await composeReviewBody({
      body: 'hand written',
      useTemplate: undefined,
      readTemplate,
      provenance: '<!-- alicorn:provenance:start -->P<!-- alicorn:provenance:end -->'
    })

    expect(composed.body).toBe(
      'hand written\n\n<!-- alicorn:provenance:start -->P<!-- alicorn:provenance:end -->\n'
    )
    expect(composed.useTemplate).toBe(false)
  })

  it('inlines the template when the body is empty', async () => {
    const composed = await composeReviewBody({
      body: '   ',
      useTemplate: true,
      readTemplate,
      provenance: '<!-- alicorn:provenance:start -->P<!-- alicorn:provenance:end -->'
    })

    expect(composed.body).toContain('## Summary')
    expect(readTemplate).toHaveBeenCalled()
  })

  it('replaces a stale block instead of appending a second one', async () => {
    const composed = await composeReviewBody({
      body: 'kept\n\n<!-- alicorn:provenance:start -->OLD<!-- alicorn:provenance:end -->',
      useTemplate: undefined,
      readTemplate,
      provenance: '<!-- alicorn:provenance:start -->NEW<!-- alicorn:provenance:end -->'
    })

    expect(composed.body).toContain('kept')
    expect(composed.body).not.toContain('OLD')
    expect(composed.body?.match(/alicorn:provenance:start/g)).toHaveLength(1)
  })
})
