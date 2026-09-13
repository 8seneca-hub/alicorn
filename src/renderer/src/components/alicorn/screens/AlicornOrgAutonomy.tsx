/**
 * Autonomy, a project at a time.
 *
 * A policy is authored per project *and per stage* — there is no org-wide level, and inventing one
 * would be a third place for the rule to live. What "org default" means on a level here is the
 * contract's own shipped default, which is what a stage gets when nobody has authored anything. So
 * inheritance is real without a second store to keep in sync.
 *
 * **Nothing an agent does can loosen any of this.** The Control API takes the author from the
 * authenticated actor rather than the body, and the MCP surface has no autonomy tool at all — the
 * boundary is enforced by absence, not by a flag a caller could set.
 */
import React from 'react'
import { Lock } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AutonomyPolicy } from '../../../../../shared/alicorn/gate-policy'
import { autonomyStarterSet } from '../../../../../shared/alicorn/autonomy-starter-set'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import type { Project } from '../../../../../shared/alicorn/projects'
import { AlicornEmptyState } from './AlicornScreenChrome'
import { AlicornStageAutonomy } from './AlicornStageAutonomy'
import { useProjectWorkflow } from './use-project-workflow'

function useAutonomyPolicies(projectId: string | null): {
  policies: AutonomyPolicy[]
  loading: boolean
  reload: () => void
} {
  const [policies, setPolicies] = React.useState<AutonomyPolicy[]>([])
  const [loading, setLoading] = React.useState(false)
  const [reloads, setReloads] = React.useState(0)

  React.useEffect(() => {
    if (!projectId) {
      setPolicies([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const result = await window.api?.alicorn?.listAutonomyPolicies?.(projectId)
      if (!cancelled) {
        setPolicies(result?.ok ? result.policies : [])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, reloads])

  return { policies, loading, reload: () => setReloads((count) => count + 1) }
}

export function AlicornOrgAutonomy({
  projects
}: {
  projects: readonly Project[]
}): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | null>(projects[0]?.id ?? null)
  const active = projects.find((project) => project.id === projectId) ?? projects[0] ?? null
  const { workflow, loading: workflowLoading } = useProjectWorkflow(active?.id ?? '')
  const { policies, reload } = useAutonomyPolicies(active?.id ?? null)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const stages = workflow?.stages ?? []

  const authorAll = async (): Promise<void> => {
    const write = window.api?.alicorn?.setAutonomyPolicy
    if (!write || !active) {
      return
    }
    setBusy(true)
    setFailure(null)
    for (const { stageName: _stageName, ...policy } of autonomyStarterSet(stages)) {
      const result = await write(active.id, policy)
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
      <p className="mb-4 max-w-[680px] text-[12.5px] leading-relaxed text-muted-foreground">
        {translate(
          'auto.components.alicorn.org.autonomyIntro',
          'Everything on a stage is inherited from the org library until you change it here. Nothing an agent does can loosen it — a merge, a deploy or anything irreversible gates regardless of level.'
        )}
      </p>

      {projects.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setProjectId(project.id)}
              className={cn(
                'h-7 rounded-full border px-3 text-[12px] transition',
                project.id === active?.id
                  ? 'border-primary bg-accent font-medium'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {project.name}
            </button>
          ))}
        </div>
      ) : null}

      {workflowLoading ? (
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
                  'Every stage is inherited. Authoring the set writes each one explicitly, so a later change to the default cannot move this project underneath you.'
                )}
              </p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void authorAll()}>
                {translate('auto.components.alicorn.org.authorSet', 'Author all {{count}} stages', {
                  count: stages.length
                })}
              </Button>
            </div>
          ) : null}
          {failure ? <p className="mb-3 text-[11px] text-destructive">{failure}</p> : null}
          {active
            ? stages.map((stage) => (
                <AlicornStageAutonomy
                  key={stage.key}
                  projectId={active.id}
                  stage={stage}
                  policies={policies}
                  onChanged={reload}
                />
              ))
            : null}
        </>
      )}

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
