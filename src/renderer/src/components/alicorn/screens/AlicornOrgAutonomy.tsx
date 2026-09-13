/**
 * The org's autonomy floor: what every project's stage starts from.
 *
 * One level, not a table. A stage belongs to a workflow and a workflow belongs to a project, so
 * there is nothing org-wide to say about `build` specifically — what an org can say is how much it
 * trusts an unauthored stage by default. Per-stage levels live in the project that owns the stage.
 *
 * **This does not reach a project that has authored its own.** Moving the floor changes what an
 * inherited stage reads as; an overridden one is the project's answer and stays put. That is what
 * keeps "a member cannot loosen its own criteria" true even with a dial here: an org admin moves
 * the floor, a project moves its stages, and neither is the member being judged.
 */
import React from 'react'
import { Lock } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_COPY,
  SHIPPED_DEFAULT_LEVEL,
  type AutonomyLevel
} from '../../../../../shared/alicorn/autonomy-levels'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import type { OrgPolicy } from '../../../../../shared/alicorn/members'
import type { Project } from '../../../../../shared/alicorn/projects'

export function AlicornOrgAutonomy({
  projects
}: {
  projects: readonly Project[]
}): React.JSX.Element {
  const [policy, setPolicy] = React.useState<OrgPolicy | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api?.alicorn?.getOrgPolicy?.()
      if (!cancelled && result?.ok) {
        setPolicy(result.policy)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const level = policy?.defaultAutonomyLevel ?? SHIPPED_DEFAULT_LEVEL

  const choose = async (next: AutonomyLevel): Promise<void> => {
    const write = window.api?.alicorn?.setOrgPolicy
    if (!write || !policy) {
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
    const result = await write({ ...policy, defaultAutonomyLevel: next })
    setBusy(false)
    if (!result.ok) {
      setFailure(describeFailure(result))
      return
    }
    setPolicy(result.policy)
  }

  return (
    <>
      <p className="mb-5 max-w-[680px] text-[12.5px] leading-relaxed text-muted-foreground">
        {translate(
          'auto.components.alicorn.org.autonomyIntro',
          'What every project’s stage starts from. A project inherits this until it authors its own level for a stage, and a stage it has already authored is its answer — moving this floor does not move it.'
        )}
      </p>

      <div
        role="radiogroup"
        aria-label={translate(
          'auto.components.alicorn.screens.AlicornOrgAutonomy.65f46a5d0f',
          'Default autonomy'
        )}
        className="max-w-[680px] space-y-1.5"
      >
        {AUTONOMY_LEVELS.map((candidate) => {
          const active = candidate === level
          const copy = AUTONOMY_LEVEL_COPY[candidate]
          return (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => void choose(candidate)}
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
                <span className="text-[13px] font-semibold">{copy.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {copy.detail}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {failure ? <p className="mt-2 text-[11px] text-destructive">{failure}</p> : null}

      <p className="mt-5 max-w-[680px] text-[12px] text-muted-foreground">
        {projects.length === 1
          ? translate(
              'auto.components.alicorn.org.oneProjectInherits',
              'One project inherits this. Set a stage’s own level in that project’s Autonomy.'
            )
          : translate(
              'auto.components.alicorn.org.projectsInherit',
              '{{count}} projects inherit this. Set a stage’s own level in that project’s Autonomy.',
              { count: projects.length }
            )}
      </p>

      <p className="mt-5 flex max-w-[640px] items-start gap-2 text-[11px] text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" />
        {translate(
          'auto.components.alicorn.org.hardStopNote',
          'Hard stops never retire. Merge, deploy and anything irreversible or carrying inherited cost gate whatever the record says, because guessing wrong once is a production deploy.'
        )}
      </p>
    </>
  )
}
