import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ProvenanceView } from '../../../../../shared/alicorn/provenance-view'
import { CHECK_COLOR, CHECK_ICON } from './provenance-check-copy'

export function ProvenanceSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0">
      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function ProvenanceChecks({ view }: { view: ProvenanceView }): React.JSX.Element {
  return (
    <ProvenanceSection
      title={translate(
        'auto.components.right.sidebar.provenance.panel.section.checks',
        'Required checks'
      )}
    >
      {view.checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.provenance.panel.checks.none',
            'No check was recorded against this branch. A step with no green check gates as unverified.'
          )}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="provenance-checks">
          {view.checks.map((check) => {
            const Icon = CHECK_ICON[check.status]
            return (
              <li key={`${check.kind}:${check.name}`} className="flex items-start gap-2">
                <Icon className={cn('mt-0.5 size-3 shrink-0', CHECK_COLOR[check.status])} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs text-foreground">{check.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {check.ratio === null
                      ? check.status
                      : translate(
                          'auto.components.right.sidebar.provenance.panel.ProvenanceEvidenceSections.ef86fb6cb9',
                          '{{value0}}% covered',
                          { value0: Math.round(check.ratio * 100) }
                        )}
                    {check.required
                      ? ` · ${translate('auto.components.right.sidebar.provenance.panel.checks.required', 'required')}`
                      : ` · ${translate('auto.components.right.sidebar.provenance.panel.checks.advisory', 'advisory')}`}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </ProvenanceSection>
  )
}

export function ProvenancePolicy({ view }: { view: ProvenanceView }): React.JSX.Element {
  return (
    <ProvenanceSection
      title={translate(
        'auto.components.right.sidebar.provenance.panel.section.policy',
        'Policy on this run'
      )}
    >
      <p
        className={cn(
          'text-xs',
          view.reviewerRule === 'bypassed' ? 'text-destructive' : 'text-foreground'
        )}
        data-testid="provenance-reviewer-rule"
      >
        {view.reviewerRule === 'bypassed'
          ? translate(
              'auto.components.right.sidebar.provenance.panel.reviewer.bypassed',
              'Reviewer backend rule bypassed — the reviewer ran on the author’s own backend. The bypass is recorded on the run.'
            )
          : view.reviewerRule === 'enforced'
            ? translate(
                'auto.components.right.sidebar.provenance.panel.reviewer.enforced',
                'Reviewer backend rule enforced — the reviewer ran on a different backend from the author.'
              )
            : translate(
                'auto.components.right.sidebar.provenance.panel.reviewer.off',
                'Reviewer backend rule is not enforced for this organisation. That is not the same as no conflict.'
              )}
      </p>
      <p className="text-xs text-foreground" data-testid="provenance-execution">
        {view.escalation.offered
          ? `${translate('auto.components.right.sidebar.provenance.panel.escalation.offered', 'Escalation to orchestrated was offered at')} ${view.escalation.stageKey} — ${escalationVerdict(view.escalation.verdict)}`
          : translate(
              'auto.components.right.sidebar.provenance.panel.escalation.none',
              'Single agent throughout; no escalation was offered.'
            )}
      </p>
      <p className="text-xs text-muted-foreground">
        {view.contextCaptureCount > 0
          ? `${view.contextCaptureCount} ${translate('auto.components.right.sidebar.provenance.panel.context.captured', 'dispatches captured their exact prompt and context slice.')}`
          : translate(
              'auto.components.right.sidebar.provenance.panel.context.none',
              'No context capture was recorded, so an underinformed member cannot be told apart from a wrong one.'
            )}
      </p>
    </ProvenanceSection>
  )
}

function escalationVerdict(verdict: 'accepted' | 'declined' | 'unanswered'): string {
  if (verdict === 'accepted') {
    return translate(
      'auto.components.right.sidebar.provenance.panel.escalation.accepted',
      'accepted'
    )
  }
  if (verdict === 'declined') {
    return translate(
      'auto.components.right.sidebar.provenance.panel.escalation.declined',
      'declined'
    )
  }
  return translate(
    'auto.components.right.sidebar.provenance.panel.escalation.unanswered',
    'no answer'
  )
}

/**
 * The honest half. A gate reason names the rule that fired, but the figures behind it — the
 * member's run count and accept rate, the stage's authored reversibility, the policy's budgets —
 * are not in the provenance read. Saying so beats inventing them.
 */
export function ProvenanceGaps(): React.JSX.Element {
  return (
    <ProvenanceSection
      title={translate(
        'auto.components.right.sidebar.provenance.panel.section.gaps',
        'Not in this record'
      )}
    >
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.provenance.panel.gaps.body',
          'The reason above names the rule that decided. The numbers behind it — the member’s run count and accept rate on the stage, the stage’s authored reversibility, and the policy’s file and spend budgets — are not part of the provenance read, so they show as — rather than as a guess.'
        )}
      </p>
    </ProvenanceSection>
  )
}
