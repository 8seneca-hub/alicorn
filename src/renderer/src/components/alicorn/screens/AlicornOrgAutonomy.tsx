/**
 * Autonomy, across every project.
 *
 * A policy is authored *per project and per stage* — there is no org-wide level, and inventing one
 * here would be a third place for the rule to live. What this screen does org-wide is show them
 * all, and start one where there is none.
 *
 * **Authoring here does not loosen anything.** The default is `evidence`, which still gates every
 * hand-off; what it changes is whether the recorded recommendation says anything useful, which is
 * the only way evidence ever accumulates. A member still cannot author the criteria that judge it:
 * the Control API takes the author from the authenticated actor, never from the body.
 */
import React from 'react'
import { Lock } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_AUTONOMY_POLICY,
  type AutonomyPolicy
} from '../../../../../shared/alicorn/gate-policy'
import type { Project } from '../../../../../shared/alicorn/projects'
import { AlicornEmptyState } from './AlicornScreenChrome'

type ProjectPolicies = { project: Project; policies: AutonomyPolicy[] }

function usePoliciesByProject(projects: readonly Project[]): {
  rows: ProjectPolicies[]
  loading: boolean
  reload: () => void
} {
  const [rows, setRows] = React.useState<ProjectPolicies[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloads, setReloads] = React.useState(0)
  const projectIds = projects.map((project) => project.id).join(',')

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const list = window.api?.alicorn?.listAutonomyPolicies
      if (!list) {
        if (!cancelled) {
          setLoading(false)
        }
        return
      }
      const read = await Promise.all(
        projects.map(async (project) => {
          const result = await list(project.id)
          return { project, policies: result.ok ? result.policies : [] }
        })
      )
      if (!cancelled) {
        setRows(read)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Why the ids and not the array: the projects array is rebuilt on every store write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds, reloads])

  return { rows, loading, reload: () => setReloads((count) => count + 1) }
}

/**
 * The stage a first policy is authored for.
 *
 * `build` because it is the stage every workflow has and the one that runs most often, so it is
 * where evidence accumulates fastest. Other stages are authored on the workflow, one at a time.
 */
const FIRST_STAGE = 'build'

function AuthorDefault({
  project,
  onAuthored
}: {
  project: Project
  onAuthored: () => void
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  const author = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const result = await window.api?.alicorn?.setAutonomyPolicy?.(project.id, {
      stageKey: FIRST_STAGE,
      // Null is the wildcard: the policy applies to every member on that stage, which is what a
      // first policy should do. Narrowing it to one member is a later, deliberate act.
      memberId: null,
      ...DEFAULT_AUTONOMY_POLICY
    })
    setBusy(false)
    if (!result?.ok) {
      setFailure(result?.error ?? 'control_plane_unreachable')
      return
    }
    onAuthored()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void author()}>
        {translate('auto.components.alicorn.org.authorDefault', 'Start one for {{project}}', {
          project: project.name
        })}
      </Button>
      {failure ? <span className="text-[11px] text-destructive">{failure}</span> : null}
    </div>
  )
}

function ModeBadge({ mode }: { mode: AutonomyPolicy['mode'] }): React.JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
        // `never_gate` is the only mode that can skip a human, so it is the only one worth
        // colouring: attention means a human is required, and its absence is the exception here.
        mode === 'never_gate'
          ? 'border-status-attention/40 bg-status-attention/10 text-status-attention'
          : 'border-border text-muted-foreground'
      )}
    >
      {mode}
    </span>
  )
}

export function AlicornOrgAutonomy({
  projects
}: {
  projects: readonly Project[]
}): React.JSX.Element {
  const { rows, loading, reload } = usePoliciesByProject(projects)
  const withPolicies = rows.filter((row) => row.policies.length > 0)
  const withoutPolicies = rows.filter((row) => row.policies.length === 0)

  return (
    <>
      <p className="mb-5 max-w-[640px] text-[12.5px] leading-relaxed text-muted-foreground">
        {translate(
          'auto.components.alicorn.org.autonomyIntro',
          'Autonomy is authored per stage of a project, never org-wide, and it is unlocked by evidence the ledger accumulates rather than by a switch. This is what every project currently holds; a merge, a deploy or anything irreversible gates regardless of track record.'
        )}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          {translate('auto.components.alicorn.org.autonomyLoading', 'Reading policies…')}
        </p>
      ) : withPolicies.length === 0 ? (
        <AlicornEmptyState
          title={translate(
            'auto.components.alicorn.org.noAutonomyTitle',
            'Every stage still gates'
          )}
          detail={translate(
            'auto.components.alicorn.org.noAutonomyDetail',
            'No project has authored an autonomy policy, so every hand-off asks a human. That is the right starting point: evidence only accumulates by running gated. Starting one changes what gets recorded, not what gets gated.'
          )}
          action={
            <div className="mt-3 space-y-1.5">
              {rows.map((row) => (
                <AuthorDefault key={row.project.id} project={row.project} onAuthored={reload} />
              ))}
            </div>
          }
        />
      ) : (
        withPolicies.map((row) => (
          <section key={row.project.id} className="mb-4">
            <h2 className="mb-2 text-[13px] font-semibold">{row.project.name}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {row.policies.map((policy) => (
                <li
                  key={`${policy.stageKey}-${policy.memberId ?? 'all'}`}
                  className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{policy.stageKey}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {policy.memberId
                      ? translate('auto.components.alicorn.org.oneMember', 'one member')
                      : translate('auto.components.alicorn.org.everyMember', 'every member')}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {translate(
                      'auto.components.alicorn.org.evidenceBar',
                      '{{runs}} runs · {{rate}}% accepted',
                      {
                        runs: policy.minRuns,
                        rate: Math.round(policy.minAcceptRate * 100)
                      }
                    )}
                  </span>
                  <ModeBadge mode={policy.mode} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {!loading && withPolicies.length > 0 && withoutPolicies.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-[13px] font-semibold">
            {translate('auto.components.alicorn.org.noPolicyYet', 'No policy yet')}
          </h2>
          <div className="space-y-1.5">
            {withoutPolicies.map((row) => (
              <AuthorDefault key={row.project.id} project={row.project} onAuthored={reload} />
            ))}
          </div>
        </section>
      ) : null}

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
