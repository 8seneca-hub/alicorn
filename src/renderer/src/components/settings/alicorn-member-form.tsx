import {
  MEMBER_BACKENDS,
  MEMBER_ROLES,
  PERMISSION_MODES,
  WORKSPACE_KINDS,
  type MemberInput,
  type MemberSkillRef
} from '../../../../shared/alicorn/members'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

export const EMPTY_MEMBER: MemberInput = {
  name: '',
  role: 'developer',
  backend: 'claude',
  workspaceKind: 'worktree',
  permissionMode: 'accept_edits',
  systemRules: '',
  skills: []
}

// Skills round-trip through a comma-separated field; blanks are dropped so a
// trailing comma does not become an empty skill the server then rejects.
//
// PS1: `name@versionId` pins a catalog version and survives `latest` moving; a bare name follows
// latest. The last `@` splits, so a name may contain one.
export function parseSkills(value: string): MemberSkillRef[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const at = entry.lastIndexOf('@')
      if (at <= 0 || at === entry.length - 1) {
        return { name: entry, versionId: null }
      }
      return { name: entry.slice(0, at).trim(), versionId: entry.slice(at + 1).trim() }
    })
}

export function formatSkills(skills: readonly MemberSkillRef[]): string {
  return skills
    .map((skill) => (skill.versionId ? `${skill.name}@${skill.versionId}` : skill.name))
    .join(', ')
}

function EnumRow<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      control={
        <Select value={value} onValueChange={(next) => onChange(next as T)}>
          <SelectTrigger className="h-7 w-44 text-xs" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

export function AlicornMemberForm({
  draft,
  skillsText,
  saving,
  onChange,
  onSkillsTextChange,
  onSubmit,
  onCancel
}: {
  draft: MemberInput
  skillsText: string
  saving: boolean
  onChange: (next: MemberInput) => void
  onSkillsTextChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-1 rounded-md border border-border/50 bg-muted/30 p-3">
      <SettingsRow
        label={translate('auto.components.settings.alicornMembers.name', 'Name')}
        control={
          <Input
            value={draft.name}
            aria-label={translate('auto.components.settings.alicornMembers.name', 'Name')}
            className="h-7 w-44 text-xs"
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        }
      />
      <EnumRow
        label={translate('auto.components.settings.alicornMembers.role', 'Role')}
        value={draft.role}
        options={MEMBER_ROLES}
        onChange={(role) => onChange({ ...draft, role })}
      />
      <EnumRow
        label={translate('auto.components.settings.alicornMembers.backend', 'Backend')}
        value={draft.backend}
        options={MEMBER_BACKENDS}
        onChange={(backend) => onChange({ ...draft, backend })}
      />
      <EnumRow
        label={translate('auto.components.settings.alicornMembers.workspaceKind', 'Workspace kind')}
        value={draft.workspaceKind}
        options={WORKSPACE_KINDS}
        onChange={(workspaceKind) => onChange({ ...draft, workspaceKind })}
      />
      <EnumRow
        label={translate(
          'auto.components.settings.alicornMembers.permissionMode',
          'Permission mode'
        )}
        value={draft.permissionMode}
        options={PERMISSION_MODES}
        onChange={(permissionMode) => onChange({ ...draft, permissionMode })}
      />
      <SettingsRow
        alignTop
        label={translate('auto.components.settings.alicornMembers.systemRules', 'System rules')}
        control={
          <Textarea
            value={draft.systemRules}
            aria-label={translate(
              'auto.components.settings.alicornMembers.systemRules',
              'System rules'
            )}
            className="h-20 w-64 text-xs"
            onChange={(event) => onChange({ ...draft, systemRules: event.target.value })}
          />
        }
      />
      <SettingsRow
        label={translate('auto.components.settings.alicornMembers.skills', 'Skills')}
        description={translate(
          'auto.components.settings.alicornMembers.skillsHint',
          'Comma-separated. Add @version to pin a catalog version.'
        )}
        control={
          <Input
            value={skillsText}
            aria-label={translate('auto.components.settings.alicornMembers.skills', 'Skills')}
            className="h-7 w-44 text-xs"
            onChange={(event) => onSkillsTextChange(event.target.value)}
          />
        }
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          {translate('auto.components.settings.alicornMembers.cancel', 'Cancel')}
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={saving || !draft.name.trim()}>
          {translate('auto.components.settings.alicornMembers.save', 'Save')}
        </Button>
      </div>
    </div>
  )
}
