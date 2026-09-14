/**
 * One stage's autonomy, as four levels.
 *
 * A level is a reading of the policy's fields, never a fifth field — see `autonomy-levels.ts`.
 *
 * An unauthored stage picks nothing and says so. `gateReasonFor` answers `no_policy` for a stage
 * with no row and gates it, so drawing the org default as the selected level told the opposite of
 * what the engine does — the screen said "runs unattended" while the agent was being refused. The
 * org default stays visible as the value authoring would write; it is not presented as in effect.
 *
 * It also shows the facts that decide whether a level does anything: the stage's authored
 * reversibility and inherited cost, which `gateReasonFor` reads before any policy, and the ledger
 * bar an evidence-backed level has to clear. Four levels offered without those is four choices
 * where there is sometimes one.
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
import { evidenceShortfall } from '../../../../../shared/alicorn/evidence-bar'
import type { AutonomyPolicy, TrackRecord } from '../../../../../shared/alicorn/gate-policy'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import { AlicornAutonomyLevelHint } from './AlicornAutonomyLevelHint'
import { AlicornStageGateFacts } from './AlicornStageGateFacts'
import { useStageTrackRecord } from './use-stage-track-record'

/**
 * What the ledger has to show before an evidence-backed level lets a step run on its own.
 *
 * Null for the two levels that read no evidence at all. An authored row is the bar this stage is
 * actually judged against; every other level shows what picking it would write, so the difference
 * between "you have set this" and "this is what it would cost you" stays visible.
 */
function evidenceBar(
  level: AutonomyLevel,
  stageKey: string,
  authored: AutonomyPolicy | null
): { minRuns: number; minAcceptRate: number } | null {
  if (level !== 'L1' && level !== 'L2') {
    return null
  }
  const policy =
    authored && levelOfPolicy(authored) === level ? authored : policyForLevel({ level, stageKey })
  return { minRuns: policy.minRuns, minAcceptRate: policy.minAcceptRate }
}

/**
 * Where the stage stands against the bar it is judged by — "4 of 10 runs, 92% accepted".
 *
 * Only on the level actually in effect: the other rows describe what picking them would write, and
 * a progress line under a hypothetical bar reads as a claim about a bar nobody authored.
 */
function BarProgress({
  bar,
  record
}: {
  bar: { minRuns: number; minAcceptRate: number }
  record: TrackRecord | null
}): React.JSX.Element {
  const runs = record?.runs ?? 0
  const rate = Math.round((record?.acceptRate ?? 0) * 100)
  const short = evidenceShortfall(bar, record)
  return (
    <span
      className={cn(
        'mt-1 block text-[11px]',
        short ? 'text-status-attention' : 'text-status-success'
      )}
    >
      {translate(
        'auto.components.alicorn.autonomy.evidenceProgress',
        '{{runs}} of {{minRuns}} runs, {{rate}}% accepted',
        { runs, minRuns: bar.minRuns, rate }
      )}
      {' — '}
      {short === 'regression'
        ? translate(
            'auto.components.alicorn.autonomy.progressRegressed',
            'recently rejected or amended, so it gates until the bar is met again.'
          )
        : short
          ? translate(
              'auto.components.alicorn.autonomy.progressShort',
              'not there yet, so this stage still asks.'
            )
          : translate(
              'auto.components.alicorn.autonomy.progressMet',
              'the bar is met; only hard stops gate here now.'
            )}
    </span>
  )
}

function LevelRow({
  level,
  active,
  isOrgDefault,
  bar,
  progress,
  hardStop,
  onSelect
}: {
  level: AutonomyLevel
  active: boolean
  isOrgDefault: boolean
  bar: { minRuns: number; minAcceptRate: number } | null
  /** The ledger's record for this stage, shown only under the level in effect. Null when none. */
  progress: TrackRecord | null | undefined
  /** The stage gates whatever is picked, so every level above L0 promises something it cannot do. */
  hardStop: boolean
  onSelect: () => void
}): React.JSX.Element {
  const copy = AUTONOMY_LEVEL_COPY[level]
  return (
    <div className="relative">
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg border py-3 pl-3.5 pr-9 text-left transition',
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
          {bar ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {bar.minRuns === 0
                ? translate(
                    'auto.components.alicorn.autonomy.evidenceBarNone',
                    'Evidence bar — none to clear.'
                  )
                : translate(
                    'auto.components.alicorn.autonomy.evidenceBar',
                    'Evidence bar — {{runs}} runs at {{rate}}% accepted, on this stage, before anything runs unasked.',
                    { runs: bar.minRuns, rate: Math.round(bar.minAcceptRate * 100) }
                  )}
            </span>
          ) : null}
          {bar && progress !== undefined && !hardStop ? (
            <BarProgress bar={bar} record={progress} />
          ) : null}
          {hardStop && level !== 'L0' ? (
            <span className="mt-1 block text-[11px] text-status-attention">
              {translate(
                'auto.components.alicorn.autonomy.noEffectHere',
                'No effect on this stage — it is a hard stop and gates before any policy is read.'
              )}
            </span>
          ) : null}
        </span>
      </button>
      {/* Outside the radio rather than inside it: a button within a button is not clickable, and a
          click meant for the icon would pick the level. */}
      <span className="absolute right-2.5 top-3">
        <AlicornAutonomyLevelHint level={level} />
      </span>
    </div>
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
  const record = useStageTrackRecord(projectId, stage)
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
            {translate('auto.components.alicorn.autonomy.notAuthored', 'not authored')}
          </span>
        )}
      </div>
      <AlicornStageGateFacts stage={stage} />
      {hardStop ? (
        <p className="mb-2 text-[11.5px] text-status-attention">
          {translate(
            'auto.components.alicorn.autonomy.hardStopStage',
            'This stage gates at every level — it is irreversible or carries inherited cost, and that is read before any policy.'
          )}
        </p>
      ) : !authored ? (
        <p className="mb-2 text-[11.5px] text-status-attention">
          {translate(
            'auto.components.alicorn.autonomy.unauthoredGates',
            'Nothing is authored here, so this stage gates — a step with no policy is one a human decides. The org default is marked below as what picking it would write, not as what is in effect.'
          )}
        </p>
      ) : null}
      <div role="radiogroup" aria-label={stage.name} className="space-y-1.5">
        {AUTONOMY_LEVELS.map((candidate) => (
          <LevelRow
            key={candidate}
            level={candidate}
            // Only an authored row reads as chosen. Filling the radio on the inherited level made
            // an unauthored stage look governed when `gateReasonFor` gates it for having no row.
            active={authored !== null && candidate === level}
            isOrgDefault={candidate === inherited}
            bar={evidenceBar(candidate, stage.key, authored)}
            // Only the authored level is in effect, so only it has a record to stand against.
            progress={authored !== null && candidate === level ? record : undefined}
            hardStop={hardStop}
            onSelect={() => void choose(candidate)}
          />
        ))}
      </div>
      {failure ? <p className="mt-1.5 text-[11px] text-destructive">{failure}</p> : null}
    </section>
  )
}
