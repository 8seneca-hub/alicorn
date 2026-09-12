/**
 * Authoring what has to pass before a hand-off.
 *
 * Admin-authored per project, which is the whole point: a member may not write the criteria that
 * judge it (CLAUDE.md). Until workflows carry stages that can hold their own checks, a project is
 * the unit — so this list is the project's answer for every stage in it.
 *
 * Whole-set replace, because that is what the API stores. A partial write would drop the checks it
 * did not mention.
 */
import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { RequiredCheck } from '../../../../../shared/alicorn/members'

type Draft =
  | { kind: 'diff_coverage'; threshold: string; lcovPath: string; command: string }
  | { kind: 'contract_acknowledged' }
  | { kind: 'integration_verify'; command: string; repoId: string }
  | { kind: 'skill'; skillId: string; versionId: string }

const EMPTY: Record<RequiredCheck['kind'], Draft> = {
  diff_coverage: {
    kind: 'diff_coverage',
    threshold: '80',
    lcovPath: 'coverage/lcov.info',
    command: ''
  },
  contract_acknowledged: { kind: 'contract_acknowledged' },
  integration_verify: { kind: 'integration_verify', command: '', repoId: '' },
  skill: { kind: 'skill', skillId: '', versionId: '' }
}

const KIND_LABELS: Record<RequiredCheck['kind'], string> = {
  diff_coverage: 'Diff coverage',
  contract_acknowledged: 'Contract acknowledged',
  integration_verify: 'Integration verify',
  skill: 'Skill'
}

/** Null when the draft is not yet a check the API would accept. */
function toCheck(draft: Draft): RequiredCheck | null {
  if (draft.kind === 'contract_acknowledged') {
    return { kind: 'contract_acknowledged' }
  }
  if (draft.kind === 'diff_coverage') {
    const percent = Number(draft.threshold)
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || !draft.lcovPath.trim()) {
      return null
    }
    return {
      kind: 'diff_coverage',
      // Authored as a percentage because that is how a human says it; stored as the fraction the
      // contract defines.
      threshold: percent / 100,
      lcovPath: draft.lcovPath.trim(),
      ...(draft.command.trim() ? { command: draft.command.trim() } : {}),
      timeoutMs: 600_000
    }
  }
  if (draft.kind === 'integration_verify') {
    return draft.command.trim() && draft.repoId.trim()
      ? { kind: 'integration_verify', command: draft.command.trim(), repoId: draft.repoId.trim() }
      : null
  }
  return draft.skillId.trim()
    ? {
        kind: 'skill',
        skillId: draft.skillId.trim(),
        ...(draft.versionId.trim() ? { versionId: draft.versionId.trim() } : {})
      }
    : null
}

export function describeRequiredCheck(check: RequiredCheck): string {
  if (check.kind === 'diff_coverage') {
    return `${Math.round(check.threshold * 100)}% of changed lines · ${check.lcovPath}`
  }
  if (check.kind === 'integration_verify') {
    return `${check.command} · ${check.repoId}`
  }
  if (check.kind === 'skill') {
    return check.versionId ? `${check.skillId}@${check.versionId}` : check.skillId
  }
  return translate(
    'auto.components.alicorn.checks.contractDetail',
    'Every breaking interface change is acknowledged'
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 basis-[160px] flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? ''}
        className="h-8 text-xs"
      />
    </label>
  )
}

export function AlicornRequiredCheckComposer({
  busy,
  onAdd
}: {
  busy: boolean
  onAdd: (check: RequiredCheck) => void
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<Draft>(EMPTY.diff_coverage)
  const check = toCheck(draft)

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(KIND_LABELS) as RequiredCheck['kind'][]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setDraft(EMPTY[kind])}
            className={cn(
              'h-7 rounded-md border px-2.5 text-[12px] transition',
              draft.kind === kind
                ? 'border-foreground/30 bg-accent font-semibold'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {draft.kind === 'diff_coverage' ? (
          <>
            <Field
              label={translate(
                'auto.components.alicorn.checks.threshold',
                'Percent of changed lines'
              )}
              value={draft.threshold}
              onChange={(threshold) => setDraft({ ...draft, threshold })}
            />
            <Field
              label={translate('auto.components.alicorn.checks.lcov', 'lcov path')}
              value={draft.lcovPath}
              onChange={(lcovPath) => setDraft({ ...draft, lcovPath })}
            />
            <Field
              label={translate(
                'auto.components.alicorn.checks.commandOptional',
                'Command (optional)'
              )}
              value={draft.command}
              onChange={(command) => setDraft({ ...draft, command })}
              placeholder={translate(
                'auto.components.alicorn.screens.AlicornRequiredCheckComposer.f04e67b071',
                'pnpm test --coverage'
              )}
            />
          </>
        ) : null}

        {draft.kind === 'integration_verify' ? (
          <>
            <Field
              label={translate('auto.components.alicorn.checks.command', 'Command')}
              value={draft.command}
              onChange={(command) => setDraft({ ...draft, command })}
              placeholder={translate(
                'auto.components.alicorn.screens.AlicornRequiredCheckComposer.26f5de7a59',
                'pnpm e2e'
              )}
            />
            <Field
              label={translate('auto.components.alicorn.checks.repoId', 'Repository id')}
              value={draft.repoId}
              onChange={(repoId) => setDraft({ ...draft, repoId })}
            />
          </>
        ) : null}

        {draft.kind === 'skill' ? (
          <>
            <Field
              label={translate('auto.components.alicorn.checks.skillId', 'Catalog skill id')}
              value={draft.skillId}
              onChange={(skillId) => setDraft({ ...draft, skillId })}
            />
            <Field
              label={translate('auto.components.alicorn.checks.versionId', 'Version (optional)')}
              value={draft.versionId}
              onChange={(versionId) => setDraft({ ...draft, versionId })}
            />
          </>
        ) : null}

        {draft.kind === 'contract_acknowledged' ? (
          <p className="min-w-0 flex-1 basis-[240px] text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.checks.contractHint',
              'No parameters: what is breaking is the contract registry’s answer, and who may accept it is the API’s.'
            )}
          </p>
        ) : null}

        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={busy || check === null}
          onClick={() => {
            if (check) {
              onAdd(check)
              setDraft(EMPTY[draft.kind])
            }
          }}
        >
          <Plus className="size-3.5" />
          {translate('auto.components.alicorn.checks.add', 'Add check')}
        </Button>
      </div>
    </section>
  )
}

export function RequiredCheckRow({
  check,
  busy,
  onRemove
}: {
  check: RequiredCheck
  busy: boolean
  onRemove: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
      <span className="shrink-0 font-mono text-[12px]">{check.kind}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {describeRequiredCheck(check)}
      </span>
      <Button size="xs" variant="ghost" disabled={busy} onClick={onRemove} className="shrink-0">
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  )
}
