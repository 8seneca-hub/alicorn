/**
 * What this project is wired to, and what that wiring does.
 *
 * It was removed once as redundant with MCP Servers, and that was wrong in a specific way: MCP
 * Servers says which *tools an agent has*, which is a different question from which board this
 * project imports from and which repository its diffs land in. A project now records its source
 * (provider, board, identifier), so there is a real binding to show rather than a list of toggles.
 *
 * Read-only about the connection itself: connecting a provider is a device-wide act with a
 * credential, and doing it twice in two places is how one of them ends up stale. This screen shows
 * the binding, links to where the credential lives, and offers the two actions that belong to a
 * project — import a task from the board, and open the board.
 */
import React from 'react'
import { ArrowUpRight, Check, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  canListBoardIssues,
  isPmProviderConnected,
  PM_PROVIDER_LABELS,
  PM_PROVIDERS,
  type PmProvider
} from './pm-import-providers'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { Repo } from '../../../../../shared/repo-types'
import { AlicornScreenBody, AlicornScreenHeader, type AlicornCrumb } from './AlicornScreenChrome'

function Row({
  title,
  detail,
  right
}: {
  title: string
  detail: string
  right?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{detail}</div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}

function Connected(): React.JSX.Element {
  return (
    <span className="flex items-center gap-1 rounded-full border border-status-running/40 bg-status-running/10 px-2 py-0.5 text-[11px] text-status-running">
      <Check className="size-3" />
      {translate('auto.components.alicorn.integrations.connected', 'connected')}
    </span>
  )
}

export function AlicornProjectIntegrations({
  crumbs,
  project,
  repos,
  onOpenTasks
}: {
  crumbs: AlicornCrumb[]
  project: Project
  repos: readonly Repo[]
  onOpenTasks: () => void
}): React.JSX.Element {
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const [connected, setConnected] = React.useState<readonly PmProvider[]>([])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const answers = await Promise.all(
        PM_PROVIDERS.map(async (name) => [name, await isPmProviderConnected(name)] as const)
      )
      if (!cancelled) {
        setConnected(answers.filter(([, ok]) => ok).map(([name]) => name))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const source = project.source
  const scoped = canListBoardIssues(source)

  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.integrations', 'Integrations')}
      />
      <AlicornScreenBody>
        <h2 className="text-[13px] font-semibold">
          {translate('auto.components.alicorn.integrations.pmTitle', 'Project management')}
        </h2>
        <p className="mt-1 max-w-[620px] text-[12.5px] text-muted-foreground">
          {translate(
            'auto.components.alicorn.integrations.pmLede',
            'Where the work is tracked before it becomes a task. Alicorn imports from one of these — it does not replace it.'
          )}
        </p>

        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {source ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3.5 py-3">
                <span className="text-[13px] font-semibold">
                  {PM_PROVIDER_LABELS[source.provider]}
                </span>
                {connected.includes(source.provider) ? <Connected /> : null}
                <span className="text-[12px] text-muted-foreground">
                  {source.identifier || source.boardId}
                </span>
              </div>
              <Row
                title={translate('auto.components.alicorn.integrations.board', 'Board')}
                detail={translate(
                  'auto.components.alicorn.integrations.boardDetail',
                  'Mapped to {{project}}. One board per Alicorn project.',
                  { project: project.name }
                )}
                right={
                  <span className="rounded-md border border-border px-2 py-1 font-mono text-[11px]">
                    {source.identifier || source.boardId}
                  </span>
                }
              />
              <Row
                title={translate('auto.components.alicorn.integrations.issues', 'Issues')}
                detail={
                  scoped
                    ? translate(
                        'auto.components.alicorn.integrations.issuesScoped',
                        'Read live when you write a ticket. They are never copied in, so the tracker stays the one place an issue lives.'
                      )
                    : translate(
                        'auto.components.alicorn.integrations.issuesUnscoped',
                        'This provider’s client cannot list one board’s issues yet, so the composer cannot offer them. Nothing is shown rather than the wrong board’s.'
                      )
                }
                right={
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenTasks}>
                    {translate('auto.components.alicorn.integrations.newTask', 'New task')}
                  </Button>
                }
              />
            </>
          ) : (
            <Row
              title={translate('auto.components.alicorn.integrations.none', 'Not imported')}
              detail={translate(
                'auto.components.alicorn.integrations.noneDetail',
                'This project was typed here rather than imported, so it is bound to no board. Import a project to bind one.'
              )}
            />
          )}
        </div>

        <h2 className="mt-7 text-[13px] font-semibold">
          {translate('auto.components.alicorn.integrations.scmTitle', 'Source control')}
        </h2>
        <p className="mt-1 max-w-[620px] text-[12.5px] text-muted-foreground">
          {translate(
            'auto.components.alicorn.integrations.scmLede',
            'Where the diff lands. A project owns the repositories one feature may span.'
          )}
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {repos.length === 0 ? (
            <Row
              title={translate('auto.components.alicorn.integrations.noRepo', 'No repository')}
              detail={translate(
                'auto.components.alicorn.integrations.noRepoDetail',
                'Nothing resolved on this machine, so a task here has nowhere to run.'
              )}
            />
          ) : (
            repos.map((repo) => (
              <Row
                key={repo.id}
                title={repo.displayName}
                detail={repo.path}
                right={
                  <span
                    className={cn(
                      'rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground'
                    )}
                  >
                    {repo.kind === 'folder'
                      ? translate('auto.components.alicorn.integrations.folder', 'folder')
                      : translate('auto.components.alicorn.integrations.git', 'git')}
                  </span>
                }
              />
            ))
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Plug className="size-3.5 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.integrations.credentialNote',
              'A provider is connected once for the device, not per project — a credential in two places is how one of them goes stale.'
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openSettingsTarget({ pane: 'integrations', repoId: null })}
          >
            {translate('auto.components.alicorn.integrations.manage', 'Connected accounts')}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </AlicornScreenBody>
    </>
  )
}
