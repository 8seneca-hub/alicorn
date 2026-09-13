/**
 * Members and Checks for one project.
 *
 * Members are read-only here and that is not a gap: per-project overrides of what the library says
 * are not built, so a second editor would only be a second answer. Checks are authored here on
 * purpose — per project by an admin, precisely so the member being judged cannot reach them.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { Member, RequiredCheck } from '../../../../../shared/alicorn/members'
import { AlicornRequiredCheckComposer, RequiredCheckRow } from './AlicornRequiredCheckComposer'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-4 max-w-2xl text-[12.5px] text-muted-foreground">{children}</p>
}

/**
 * A check has no id — it is authored as a shape, so the shape is its identity. Two checks that
 * serialise the same are the same requirement, not two of them.
 */
function requiredCheckKey(check: RequiredCheck): string {
  return JSON.stringify(check)
}

export function AlicornProjectMembers({
  projectName,
  onAllProjects
}: {
  projectName: string
  onAllProjects: () => void
}): React.JSX.Element {
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
      <AlicornScreenHeader
        crumbs={projectCrumbs(projectName, onAllProjects)}
        title={translate(
          'auto.components.alicorn.screens.AlicornProjectLibrary.5fa28618f3',
          'Members'
        )}
      />
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

export function AlicornProjectChecks({
  projectName,
  projectId,
  onAllProjects
}: {
  projectName: string
  projectId: string
  onAllProjects: () => void
}): React.JSX.Element {
  const [checks, setChecks] = React.useState<RequiredCheck[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

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

  // Whole-set replace, because that is what the API stores: a partial write drops the rest.
  const write = async (next: RequiredCheck[]): Promise<void> => {
    const save = window.api?.alicorn?.setRequiredChecks
    if (!save) {
      setError('control_plane_unreachable')
      return
    }
    const previous = checks
    setBusy(true)
    setChecks(next)
    const result = await save(projectId, next)
    setBusy(false)
    if (result.ok) {
      setChecks(result.checks)
      return
    }
    // Put the list back: a refused write that left the new row on screen would read as saved.
    setChecks(previous)
    setError(result.error)
  }

  return (
    <>
      <AlicornScreenHeader
        crumbs={projectCrumbs(projectName, onAllProjects)}
        title={translate(
          'auto.components.alicorn.screens.AlicornProjectLibrary.1013a249e4',
          'Required Checks'
        )}
      />
      <AlicornScreenBody>
        <p className="max-w-[680px] text-[12.5px] text-muted-foreground">
          {translate(
            'auto.components.alicorn.project.checksIntro',
            'What has to pass before a hand-off in this project. Authored here by an org admin and never by the member a check judges — which is why it is not editable from the task a member is working.'
          )}
        </p>

        {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}

        {checks === null && !error ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {translate('auto.components.alicorn.project.checksLoading', 'Reading checks…')}
          </p>
        ) : (
          <>
            {(checks ?? []).length > 0 ? (
              <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
                {(checks ?? []).map((check, index) => (
                  <RequiredCheckRow
                    key={requiredCheckKey(check)}
                    check={check}
                    busy={busy}
                    onRemove={() =>
                      void write((checks ?? []).filter((_, position) => position !== index))
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.noChecksDetail',
                  'Nothing has to pass before a hand-off in this project yet. Checks are authored by an org admin — never by the member they judge.'
                )}
              </p>
            )}

            <AlicornRequiredCheckComposer
              busy={busy}
              onAdd={(check) => void write([...(checks ?? []), check])}
            />
          </>
        )}
      </AlicornScreenBody>
    </>
  )
}
