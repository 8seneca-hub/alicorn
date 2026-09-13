/**
 * One project's workflows: which stages run, who runs them, and what each one gates on.
 *
 * The stage list is read-only and stays that way — required checks, reversibility and inherited
 * cost are authored by an org admin on the canvas, never by the member a stage judges, and a second
 * editor here would be a second answer to that question. Creating a workflow is different: it
 * authors nothing about how a stage is judged, so it belongs where you notice the project has none.
 */
import React from 'react'
import { Lock, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useProjectWorkflow } from './use-project-workflow'
import { AlicornNewWorkflowDialog } from './AlicornNewWorkflowDialog'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-4 max-w-2xl text-[12.5px] text-muted-foreground">{children}</p>
}

export function AlicornProjectWorkflow({
  projectName,
  projectId,
  onAllProjects
}: {
  projectName: string
  projectId: string
  onAllProjects: () => void
}): React.JSX.Element {
  const { workflows, workflow, error, loading, select, reload } = useProjectWorkflow(projectId)
  const { members } = useAlicornMembers()
  const columns = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  const [composing, setComposing] = React.useState(false)

  const composer = (
    <AlicornNewWorkflowDialog
      open={composing}
      onOpenChange={setComposing}
      projectId={projectId}
      projectName={projectName}
      onCreated={(created) => {
        // Select it before reloading, so the list comes back with the new one already open.
        select(created.id)
        reload()
      }}
    />
  )

  return (
    <>
      <AlicornScreenHeader
        crumbs={projectCrumbs(projectName, onAllProjects)}
        title={translate(
          'auto.components.alicorn.screens.AlicornProjectLibrary.51cc76f872',
          'Workflow'
        )}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setComposing(true)}>
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.project.newWorkflow', 'New workflow')}
          </Button>
        }
      />
      <AlicornScreenBody>
        {error ? (
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.workflowErrorTitle',
              'Workflows could not be read'
            )}
            detail={error}
          />
        ) : loading ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
          </p>
        ) : !workflow ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.project.noWorkflowTitle', 'No workflow yet')}
            detail={translate(
              'auto.components.alicorn.project.noWorkflowDetail',
              'A workflow is optional. Without one a task is still a task — it just has no stage to hand off at.'
            )}
            action={
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setComposing(true)}>
                <Plus className="size-3.5" />
                {translate('auto.components.alicorn.project.newWorkflow', 'New workflow')}
              </Button>
            }
          />
        ) : (
          <>
            {workflows.length > 1 ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {workflows.map((summary) => (
                  <button
                    key={summary.id}
                    type="button"
                    onClick={() => select(summary.id)}
                    aria-current={summary.id === workflow.id ? 'true' : undefined}
                    className={cn(
                      'h-7 rounded-full border px-3 text-[12px] transition',
                      summary.id === workflow.id
                        ? 'border-primary bg-accent font-medium'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {summary.name}
                  </button>
                ))}
              </div>
            ) : null}
            <h2 className="text-[15px] font-semibold">{workflow.name}</h2>
            <p className="mt-1 max-w-[680px] text-[12.5px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.project.workflowIntro',
                'Required checks, reversibility and inherited cost are authored per stage by an org admin — never by the member a stage judges. A stage with no column is never dispatched by a board move.'
              )}
            </p>
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {workflow.stages.map((stage) => {
                const member = (members ?? []).find((candidate) => candidate.id === stage.memberId)
                const column = columns.find((candidate) => candidate.id === stage.columnId)
                return (
                  <li
                    key={stage.key}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-[13px]"
                  >
                    <span className="w-6 shrink-0 tabular-nums text-[11px] text-muted-foreground">
                      {stage.ordinal + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{stage.name}</span>
                    {stage.kind === 'code' ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {translate('auto.components.alicorn.project.stageCode', 'code · no member')}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {member
                          ? `${member.name} · ${member.backend}`
                          : translate(
                              'auto.components.alicorn.project.stageUnassigned',
                              'unassigned'
                            )}
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {column
                        ? translate(
                            'auto.components.alicorn.project.stageColumn',
                            'from {{column}}',
                            {
                              column: column.label
                            }
                          )
                        : translate('auto.components.alicorn.project.stageNoColumn', 'no column')}
                    </span>
                    {stage.reversibility === 'irreversible' ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-status-attention/40 bg-status-attention/10 px-2 py-0.5 text-[11px] text-status-attention">
                        <Lock className="size-3" />
                        {translate('auto.components.alicorn.project.stageHardStop', 'always gates')}
                      </span>
                    ) : null}
                    {stage.inheritedCost === 'high' ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {translate(
                          'auto.components.alicorn.project.stageInherited',
                          'inherited cost'
                        )}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {stage.requiredChecks.length === 1
                        ? translate('auto.components.alicorn.project.stageOneCheck', '1 check')
                        : translate(
                            'auto.components.alicorn.project.stageChecks',
                            '{{count}} checks',
                            {
                              count: stage.requiredChecks.length
                            }
                          )}
                    </span>
                  </li>
                )
              })}
            </ul>
            <Note>
              {translate(
                'auto.components.alicorn.project.workflowVersionNote',
                'Version {{version}}. Editing the graph is the workflow canvas’ job — this screen creates and reads one, it does not rewire it.',
                { version: workflow.version }
              )}
            </Note>
          </>
        )}
      </AlicornScreenBody>
      {composer}
    </>
  )
}
