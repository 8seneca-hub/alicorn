/**
 * One stage's autonomy, as four levels.
 *
 * A level is a reading of the policy's fields, never a fifth field — see `autonomy-levels.ts`. What
 * this screen adds is the inheritance: a stage nobody has authored shows the shipped default and
 * says it is inherited, so "nothing here" and "deliberately L2" never look the same.
 *
 * Nothing an agent does can reach this. The Control API takes the author from the authenticated
 * actor, and the MCP surface has no autonomy tool at all — the boundary is enforced by absence.
 */
import React from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_COPY,
  levelOfPolicy,
  policyForLevel,
  type AutonomyLevel
} from '../../../../../shared/alicorn/autonomy-levels'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import type { AutonomyPolicy } from '../../../../../shared/alicorn/gate-policy'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'

function LevelRow({
  level,
  active,
  isOrgDefault,
  onSelect
}: {
  level: AutonomyLevel
  active: boolean
  isOrgDefault: boolean
  onSelect: () => void
}): React.JSX.Element {
  const copy = AUTONOMY_LEVEL_COPY[level]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition',
        active ? 'border-foreground bg-accent' : 'border-border hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-foreground' : 'border-muted-foreground/50'
        )}
      >
        {active ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{copy.title}</span>
          {isOrgDefault ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {translate('auto.components.alicorn.autonomy.orgDefault', 'org default')}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">{copy.detail}</span>
      </span>
    </button>
  )
}

export function AlicornStageAutonomy({
  projectId,
  stage,
  policies,
  inherited,
  onChanged
}: {
  projectId: string
  stage: WorkflowStage
  policies: readonly AutonomyPolicy[]
  /** The org's default, which an unauthored stage takes. */
  inherited: AutonomyLevel
  onChanged: () => void
}): React.JSX.Element {
  const authored = policies.find((policy) => policy.stageKey === stage.key) ?? null
  const level = levelOfPolicy(authored, inherited)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  // A hard stop reads whatever is authored and gates anyway, so the screen says so rather than
  // letting someone pick L3 and believe it.
  const hardStop = stage.reversibility === 'irreversible' || stage.inheritedCost === 'high'

  const choose = async (next: AutonomyLevel): Promise<void> => {
    const write = window.api?.alicorn?.setAutonomyPolicy
    if (!write) {
      setFailure(
        translate(
          'auto.components.alicorn.org.needsRestart',
          'This build of the app has no autonomy bridge yet — restart Alicorn to pick it up.'
        )
      )
      return
    }
    setBusy(true)
    setFailure(null)
    const result = await write(projectId, policyForLevel({ level: next, stageKey: stage.key }))
    setBusy(false)
    if (!result.ok) {
      setFailure(describeFailure(result))
      return
    }
    onChanged()
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{stage.name}</h2>
        <span className="flex-1" />
        {authored ? (
          <>
            <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px]">
              {translate('auto.components.alicorn.autonomy.overridden', 'overridden')}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="gap-1"
              disabled={busy}
              onClick={() => void choose(inherited)}
            >
              <RotateCcw className="size-3" />
              {translate('auto.components.alicorn.autonomy.reset', 'reset to org')}
            </Button>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {translate('auto.components.alicorn.autonomy.inherited', 'inherited')}
          </span>
        )}
      </div>
      {hardStop ? (
        <p className="mb-2 text-[11.5px] text-status-attention">
          {translate(
            'auto.components.alicorn.autonomy.hardStopStage',
            'This stage gates at every level — it is irreversible or carries inherited cost, and that is read before any policy.'
          )}
        </p>
      ) : null}
      <div role="radiogroup" aria-label={stage.name} className="space-y-1.5">
        {AUTONOMY_LEVELS.map((candidate) => (
          <LevelRow
            key={candidate}
            level={candidate}
            active={candidate === level}
            isOrgDefault={candidate === inherited}
            onSelect={() => void choose(candidate)}
          />
        ))}
      </div>
      {failure ? <p className="mt-1.5 text-[11px] text-destructive">{failure}</p> : null}
    </section>
  )
}
