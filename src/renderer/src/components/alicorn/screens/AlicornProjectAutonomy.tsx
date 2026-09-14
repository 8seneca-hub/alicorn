/**
 * One project's autonomy, stage by stage.
 *
 * It lives here rather than in the org because a stage belongs to a project's workflow: `build` in
 * a feature pipeline and `build` in an investigation are not the same stage, and a level set once
 * for both would be a level set for neither. What the org holds is the floor every unauthored stage
 * starts from — Organisation → Autonomy.
 *
 * Nothing an agent does reaches this. The Control API takes the author from the authenticated
 * actor, and the MCP surface has no autonomy tool at all: the boundary is enforced by absence.
 */
import React from 'react'
import { Lock } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  SHIPPED_DEFAULT_LEVEL,
  type AutonomyLevel
} from '../../../../../shared/alicorn/autonomy-levels'
import { autonomyStarterSet } from '../../../../../shared/alicorn/autonomy-starter-set'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import type { AutonomyPolicy } from '../../../../../shared/alicorn/gate-policy'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  type AlicornCrumb
} from './AlicornScreenChrome'
import { AlicornStageAutonomy } from './AlicornStageAutonomy'
import { useProjectWorkflow } from './use-project-workflow'

export function useAutonomyPolicies(projectId: string | null): {
  policies: AutonomyPolicy[]
  reload: () => void
} {
  const [policies, setPolicies] = React.useState<AutonomyPolicy[]>([])
  const [reloads, setReloads] = React.useState(0)

  React.useEffect(() => {
    if (!projectId) {
      setPolicies([])
      return
    }
    let cancelled = false
    void (async () => {
      const result = await window.api?.alicorn?.listAutonomyPolicies?.(projectId)
      if (!cancelled) {
        setPolicies(result?.ok ? result.policies : [])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, reloads])

  return { policies, reload: () => setReloads((count) => count + 1) }
}

/** The org's floor, so an unauthored stage can say what it is inheriting rather than guessing. */
function useOrgDefaultLevel(): AutonomyLevel {
  const [level, setLevel] = React.useState<AutonomyLevel>(SHIPPED_DEFAULT_LEVEL)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api?.alicorn?.getOrgPolicy?.()
      if (!cancelled && result?.ok) {
        setLevel(result.policy.defaultAutonomyLevel)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return level
}

export function AlicornProjectAutonomy({
  crumbs,
  projectId
}: {
  crumbs: AlicornCrumb[]
  projectId: string
}): React.JSX.Element {
  const { workflow, loading } = useProjectWorkflow(projectId)
  const { policies, reload } = useAutonomyPolicies(projectId)
  const inherited = useOrgDefaultLevel()
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const stages = workflow?.stages ?? []

  const authorAll = async (): Promise<void> => {
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
    for (const { stageName: _stageName, ...policy } of autonomyStarterSet(stages)) {
      const result = await write(projectId, policy)
      if (!result.ok) {
        setBusy(false)
        setFailure(describeFailure(result))
        return
      }
    }
    setBusy(false)
    reload()
  }

  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.autonomy', 'Autonomy')}
      />
      <AlicornScreenBody>
        <p className="mb-4 max-w-[680px] text-[12.5px] leading-relaxed text-muted-foreground">
          {translate(
            'auto.components.alicorn.project.autonomyLede',
            'A stage gates until you author a level for it here — a step with no policy is one a human decides. The org library sets what authoring writes by default. Nothing an agent does can loosen any of it: a merge, a deploy or anything irreversible gates regardless of level.'
          )}
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
          </p>
        ) : stages.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.org.noStagesTitle', 'No stages to govern')}
            detail={translate(
              'auto.components.alicorn.org.noStagesDetail',
              'Autonomy is authored per stage, so a project needs a workflow before it has anything to author. A task with no workflow runs as a raw session and gates nothing.'
            )}
          />
        ) : (
          <>
            {policies.length === 0 ? (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
                <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                  {translate(
                    'auto.components.alicorn.org.everyStageInherits',
                    'No stage is authored yet, so every one of them gates. Authoring the set writes each stage explicitly — which is also what stops a later change to the org default from moving this project underneath you.'
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void authorAll()}
                >
                  {translate(
                    'auto.components.alicorn.org.authorSet',
                    'Author all {{count}} stages',
                    { count: stages.length }
                  )}
                </Button>
              </div>
            ) : null}
            {failure ? <p className="mb-3 text-[11px] text-destructive">{failure}</p> : null}
            {stages.map((stage) => (
              <AlicornStageAutonomy
                key={stage.key}
                projectId={projectId}
                stage={stage}
                policies={policies}
                inherited={inherited}
                onChanged={reload}
              />
            ))}
          </>
        )}

        <p className="mt-5 flex max-w-[640px] items-start gap-2 text-[11px] text-muted-foreground">
          <Lock className="mt-0.5 size-3 shrink-0" />
          {translate(
            'auto.components.alicorn.org.hardStopNote',
            'Hard stops never retire. Merge, deploy and anything irreversible or carrying inherited cost gate whatever the record says, because guessing wrong once is a production deploy.'
          )}
        </p>
      </AlicornScreenBody>
    </>
  )
}
