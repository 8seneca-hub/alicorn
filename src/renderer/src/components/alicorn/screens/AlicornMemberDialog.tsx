/**
 * Authoring a member: a role bound to a backend, a permission mode, and the skills it carries.
 *
 * The library was read-only, which made the eight seeded members the only members anyone could
 * ever have — and the one field people actually want to change, which skills a role carries, was
 * unreachable from the product entirely.
 *
 * A member is org-wide by design (see use-alicorn-members): every project consumes the same
 * library. Editing here therefore edits it everywhere, and the dialog says so rather than implying
 * a project-local copy that does not exist.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import {
  MEMBER_BACKENDS,
  MEMBER_ROLES,
  PERMISSION_MODES,
  WORKSPACE_KINDS,
  type Member,
  type MemberInput
} from '../../../../../shared/alicorn/members'
import { AlicornMemberSkillsField } from './AlicornMemberSkillsField'

const EMPTY: MemberInput = {
  name: '',
  role: 'developer',
  backend: 'claude',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: []
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

const SELECT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] capitalize'

export function AlicornMemberDialog({
  member,
  onOpenChange,
  onSaved
}: {
  /** The member being edited, or null to author a new one. */
  member: Member | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<MemberInput>(member ?? EMPTY)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const patch = (next: Partial<MemberInput>): void =>
    setDraft((current) => ({ ...current, ...next }))

  const submit = async (): Promise<void> => {
    const api = window.api?.alicorn
    const write = member ? api?.updateMember : api?.createMember
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
    try {
      const result = member
        ? await api!.updateMember(member.id, draft)
        : await api!.createMember(draft)
      if (!result.ok) {
        setFailure(describeFailure(result))
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setFailure(describeFailure(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="max-w-[560px]">
      <DialogHeader>
        <DialogTitle>
          {member
            ? translate('auto.components.alicorn.member.edit', 'Edit {{name}}', {
                name: member.name
              })
            : translate('auto.components.alicorn.member.new', 'New member')}
        </DialogTitle>
      </DialogHeader>

      <div className="scrollbar-sleek max-h-[60vh] space-y-3.5 overflow-y-auto px-1">
        <Field label={translate('auto.components.alicorn.member.name', 'Name')}>
          <input
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={translate('auto.components.alicorn.member.namePlaceholder', 'Reviewer')}
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12.5px]"
          />
        </Field>

        <div className="flex gap-3">
          <Field label={translate('auto.components.alicorn.member.role', 'Role')}>
            <select
              value={draft.role}
              onChange={(event) => patch({ role: event.target.value as MemberInput['role'] })}
              className={SELECT_CLASS}
            >
              {MEMBER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field label={translate('auto.components.alicorn.member.backend', 'Backend')}>
            <select
              value={draft.backend}
              onChange={(event) => patch({ backend: event.target.value as MemberInput['backend'] })}
              className={SELECT_CLASS}
            >
              {MEMBER_BACKENDS.map((backend) => (
                <option key={backend} value={backend}>
                  {backend}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex gap-3">
          <Field label={translate('auto.components.alicorn.member.workspace', 'Workspace')}>
            <select
              value={draft.workspaceKind}
              onChange={(event) =>
                patch({ workspaceKind: event.target.value as MemberInput['workspaceKind'] })
              }
              className={SELECT_CLASS}
            >
              {WORKSPACE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </Field>
          <Field label={translate('auto.components.alicorn.member.permission', 'Permission')}>
            <select
              value={draft.permissionMode}
              onChange={(event) =>
                patch({ permissionMode: event.target.value as MemberInput['permissionMode'] })
              }
              className={SELECT_CLASS}
            >
              {PERMISSION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <AlicornMemberSkillsField skills={draft.skills} onChange={(skills) => patch({ skills })} />

        <Field label={translate('auto.components.alicorn.member.rules', 'System rules')}>
          <textarea
            value={draft.systemRules}
            onChange={(event) => patch({ systemRules: event.target.value })}
            rows={5}
            placeholder={translate(
              'auto.components.alicorn.member.rulesPlaceholder',
              'What this member always does, and never does. Rides in the brief of every task it works.'
            )}
            className="scrollbar-sleek w-full resize-none rounded-md border border-border bg-background p-2.5 font-mono text-[12px] leading-relaxed"
          />
        </Field>

        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.alicorn.member.orgWide',
            'Members are the org library — every project uses the same one, so a change here reaches all of them.'
          )}
        </p>
        {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
        </Button>
        <Button
          size="sm"
          disabled={busy || draft.name.trim().length === 0}
          onClick={() => void submit()}
        >
          {member
            ? translate('auto.components.alicorn.member.save', 'Save member')
            : translate('auto.components.alicorn.member.create', 'Create member')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
