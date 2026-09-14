/**
 * The members one project draws on.
 *
 * Read-only, and not a gap: per-project overrides of what the org library says are not built, so a
 * second editor would only be a second answer to the same question.
 *
 * Required checks used to live beside this. The *screen* is gone — authoring a check by hand was a
 * feature nobody used — but `requiredChecks` stays on a stage, because that is what `evidence` mode
 * reads when it decides whether a run has earned anything.
 */
import React from 'react'
import { BookOpen, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { AlicornMemberDialog } from './AlicornMemberDialog'
import type { Member } from '../../../../../shared/alicorn/members'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-4 max-w-2xl text-[12.5px] text-muted-foreground">{children}</p>
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
  const [reloads, setReloads] = React.useState(0)
  // null = closed; { member: null } = authoring a new one.
  const [editing, setEditing] = React.useState<{ member: Member | null } | null>(null)

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
  }, [reloads])

  return (
    <>
      <AlicornScreenHeader
        crumbs={projectCrumbs(projectName, onAllProjects)}
        title={translate(
          'auto.components.alicorn.screens.AlicornProjectLibrary.5fa28618f3',
          'Members'
        )}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setEditing({ member: null })}>
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.member.new', 'New member')}
          </Button>
        }
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
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ member })}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                    {member.skills.length > 0 ? (
                      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                        <BookOpen className="size-3" />
                        {member.skills.map((skill) => skill.name).join(', ')}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {member.role}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">
                      {member.backend}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {member.permissionMode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Note>
              {translate(
                'auto.components.alicorn.project.membersNote',
                'Every org member is available to every project, so this is the library itself — editing one here changes it everywhere. Skills attach by name and follow the catalog’s latest version.'
              )}
            </Note>
          </>
        )}
      </AlicornScreenBody>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <AlicornMemberDialog
            member={editing.member}
            onOpenChange={(open) => !open && setEditing(null)}
            onSaved={() => setReloads((count) => count + 1)}
          />
        ) : null}
      </Dialog>
    </>
  )
}
