/**
 * Members, Workflow and Checks for one project.
 *
 * All three read the org library through the control plane, and all three are read-only here. That
 * is not a gap: required checks are authored per project by an admin precisely so the member being
 * judged cannot reach them, and the same argument covers the stage that carries them. Editing
 * lives in the Organisation scope, where the library is the subject rather than the judge.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { Member, RequiredCheck } from '../../../../../shared/alicorn/members'
import type { WorkflowSummary } from '../../../../../shared/alicorn/workflows'
import { AlicornEmptyState, AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-4 max-w-2xl text-[12.5px] text-muted-foreground">{children}</p>
}

export function AlicornProjectMembers({ projectName }: { projectName: string }): React.JSX.Element {
  const [members, setMembers] = React.useState<Member[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = window.api?.alicorn?.listMembers
      if (!list) {
        if (!cancelled) {
          setError('control_plane_unreachable')
        }
        return
      }
      const result = await list()
      if (cancelled) {
        return
      }
      if (result.ok) {
        setMembers(result.members)
      } else {
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title="Members" />
      <AlicornScreenBody>
        {error ? (
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.membersErrorTitle',
              'Members could not be read'
            )}
            detail={error}
          />
        ) : members === null ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.membersLoading', 'Reading members…')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{member.role}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">
                    {member.backend}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {member.permissionMode}
                  </span>
                </li>
              ))}
            </ul>
            <Note>
              {translate(
                'auto.components.alicorn.project.membersNote',
                'Every org member is available to every project. Per-project overrides — a different backend here than the library says — are not built yet, so this list is the library’s own answer.'
              )}
            </Note>
          </>
        )}
      </AlicornScreenBody>
    </>
  )
}

export function AlicornProjectWorkflow({
  projectName,
  projectId
}: {
  projectName: string
  projectId: string
}): React.JSX.Element {
  const [workflows, setWorkflows] = React.useState<WorkflowSummary[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = window.api?.alicorn?.listWorkflows
      if (!list) {
        if (!cancelled) {
          setError('control_plane_unreachable')
        }
        return
      }
      const result = await list(projectId)
      if (cancelled) {
        return
      }
      if (result.ok) {
        setWorkflows(result.workflows)
      } else {
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <>
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title="Workflow" />
      <AlicornScreenBody>
        {error ? (
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.workflowErrorTitle',
              'Workflows could not be read'
            )}
            detail={error}
          />
        ) : workflows === null ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
          </p>
        ) : workflows.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.project.noWorkflowTitle', 'No workflow yet')}
            detail={translate(
              'auto.components.alicorn.project.noWorkflowDetail',
              'A workflow is optional. Without one a task is still a task — it just has no stage to hand off at.'
            )}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {workflows.map((workflow) => (
              <li key={workflow.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium">{workflow.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {translate('auto.components.alicorn.project.workflowVersion', 'v{{version}}', {
                    version: workflow.version
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AlicornScreenBody>
    </>
  )
}

export function AlicornProjectChecks({
  projectName,
  projectId
}: {
  projectName: string
  projectId: string
}): React.JSX.Element {
  const [checks, setChecks] = React.useState<RequiredCheck[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = window.api?.alicorn?.getRequiredChecks
      if (!read) {
        if (!cancelled) {
          setError('control_plane_unreachable')
        }
        return
      }
      const result = await read(projectId)
      if (cancelled) {
        return
      }
      if (result.ok) {
        setChecks(result.checks)
      } else {
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <>
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title="Required Checks" />
      <AlicornScreenBody>
        {error ? (
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.checksErrorTitle',
              'Checks could not be read'
            )}
            detail={error}
          />
        ) : checks === null ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.checksLoading', 'Reading checks…')}
          </p>
        ) : checks.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.project.noChecksTitle', 'No required checks')}
            detail={translate(
              'auto.components.alicorn.project.noChecksDetail',
              'Nothing has to pass before a hand-off in this project yet. Checks are authored by an org admin — never by the member they judge.'
            )}
          />
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {checks.map((check, index) => (
                <li
                  key={`${check.kind}-${index}`}
                  className="flex items-center gap-3 px-3 py-2.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{check.kind}</span>
                  {check.kind === 'diff_coverage' ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(check.threshold * 100)}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Note>
              {translate(
                'auto.components.alicorn.project.checksNote',
                'Read-only here, and deliberately: a member cannot loosen the criteria that judge it, so the surface it is judged against is not writable from the side the work happens on.'
              )}
            </Note>
          </>
        )}
      </AlicornScreenBody>
    </>
  )
}
