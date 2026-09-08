import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Member, MemberInput } from '../../../../shared/alicorn/members'
import { Button } from '../ui/button'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { AlicornMemberForm, EMPTY_MEMBER, parseSkills } from './alicorn-member-form'
import { MemberRuleProposals } from './MemberRuleProposals'
import { translate } from '@/i18n/i18n'

const UNCONFIGURED = 'control_plane_unconfigured'

type Editing = {
  id: string | null
  draft: MemberInput
  skillsText: string
} | null

function describeMember(member: Member): string {
  return [member.role, member.backend, member.permissionMode].join(' · ')
}

export function AlicornMembersPane(): React.JSX.Element {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await window.api.alicorn.listMembers()
    setLoading(false)
    if (result.ok) {
      setMembers(result.members)
      setError(null)
      return
    }
    setError(result.error)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(async () => {
    if (!editing) {
      return
    }
    const input: MemberInput = {
      ...editing.draft,
      skills: parseSkills(editing.skillsText)
    }
    setSaving(true)
    const result = editing.id
      ? await window.api.alicorn.updateMember(editing.id, input)
      : await window.api.alicorn.createMember(input)
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setEditing(null)
    await load()
  }, [editing, load])

  const remove = useCallback(
    async (member: Member) => {
      const result = await window.api.alicorn.deleteMember(member.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      await load()
    },
    [load]
  )

  if (error === UNCONFIGURED) {
    return (
      <SettingsRow
        alignTop
        label={translate(
          'auto.components.settings.alicornMembers.unconfiguredTitle',
          'Control plane not configured'
        )}
        description={translate(
          'auto.components.settings.alicornMembers.unconfiguredDescription',
          'Set ALICORN_CONTROL_API_URL and ALICORN_LOCAL_API_TOKEN, then reopen Settings. See docs/alicorn/LOCAL-DEV.md.'
        )}
        control={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {translate('auto.components.settings.alicornMembers.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.alicornMembers.title', 'Members')}
        description={translate(
          'auto.components.settings.alicornMembers.description',
          'Reusable agent roles: backend, skills, permission mode and workspace kind.'
        )}
        action={
          <Button
            size="sm"
            disabled={editing !== null}
            onClick={() =>
              setEditing({
                id: null,
                draft: { ...EMPTY_MEMBER },
                skillsText: ''
              })
            }
          >
            {translate('auto.components.settings.alicornMembers.new', 'New member')}
          </Button>
        }
      />

      {error && error !== UNCONFIGURED ? <p className="text-xs text-destructive">{error}</p> : null}

      {editing ? (
        <AlicornMemberForm
          draft={editing.draft}
          skillsText={editing.skillsText}
          saving={saving}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSkillsTextChange={(skillsText) => setEditing({ ...editing, skillsText })}
          onSubmit={() => void submit()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.components.settings.alicornMembers.loading', 'Loading members…')}
        </p>
      ) : null}

      {/* Only after a successful read: a failed one is not an empty roster. */}
      {!loading && !error && members.length === 0 && !editing ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.alicornMembers.empty',
            'No members yet. Create one to dispatch work to a named role.'
          )}
        </p>
      ) : null}

      {members.map((member) => (
        <div key={member.id} className="space-y-2">
          <SettingsRow
            label={member.name}
            description={describeMember(member)}
            control={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      id: member.id,
                      draft: {
                        name: member.name,
                        role: member.role,
                        backend: member.backend,
                        workspaceKind: member.workspaceKind,
                        permissionMode: member.permissionMode,
                        systemRules: member.systemRules,
                        skills: member.skills
                      },
                      skillsText: member.skills.join(', ')
                    })
                  }
                >
                  {translate('auto.components.settings.alicornMembers.edit', 'Edit')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void remove(member)}>
                  {translate('auto.components.settings.alicornMembers.delete', 'Delete')}
                </Button>
              </div>
            }
          />
          {/* RB1: the member's own pending rule proposals, hidden entirely when there are none. */}
          <MemberRuleProposals member={member} onAccepted={() => void load()} />
        </div>
      ))}
    </div>
  )
}
