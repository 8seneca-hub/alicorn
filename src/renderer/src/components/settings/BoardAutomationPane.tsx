import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { BoardAutomationRule } from '../../../../shared/global-settings-types'
import type { Member } from '../../../../shared/alicorn/members'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../shared/workspace-status-defaults'

const DEFAULT_TEMPLATE = 'Review {{worktree}} for {{issue}}. Report findings; do not merge.'

function newRule(repoId: string, toStatusId: string, memberId: string): BoardAutomationRule {
  return {
    id: `rule_${Math.random().toString(16).slice(2, 10)}`,
    repoId,
    toStatusId,
    memberId,
    promptTemplate: DEFAULT_TEMPLATE,
    // Why disabled on creation: a rule that starts dispatching the moment it is typed gives no
    // chance to read it back before it spends anything.
    enabled: false
  }
}

export function BoardAutomationPane(): React.JSX.Element {
  const repos = useAppStore((store) => store.repos)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [rules, setRules] = useState<BoardAutomationRule[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  const statuses = useAppStore((store) => store.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  const activeRepoId = repoId ?? repos[0]?.id ?? null

  const load = useCallback(async () => {
    setLoading(true)
    const [ruleResult, memberResult] = await Promise.all([
      window.api.boardAutomation.listRules(activeRepoId ? { repoId: activeRepoId } : {}),
      window.api.alicorn.listMembers()
    ])
    setRules(ruleResult.rules)
    // A missing control plane is not an error here: rules can still be read and disabled, which is
    // what someone opening this pane in a hurry needs.
    setMembers(memberResult.ok ? memberResult.members : [])
    setLoading(false)
  }, [activeRepoId])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (next: BoardAutomationRule[]) => {
      if (!activeRepoId) {
        return
      }
      const previous = rules
      setRules(next)
      const result = await window.api.boardAutomation.saveRules({
        repoId: activeRepoId,
        rules: next
      })
      if (!result.ok) {
        setRules(previous)
        toast.error(
          translate(
            'auto.components.settings.boardAutomation.saveFailed',
            'Could not save board automation rules'
          )
        )
      }
    },
    [activeRepoId, rules]
  )

  const memberName = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members]
  )

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate('auto.components.settings.boardAutomation.loading', 'Loading rules…')}
      </p>
    )
  }

  if (!activeRepoId) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.settings.boardAutomation.noRepo',
          'Add a project first: automation rules are configured per board.'
        )}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {repos.length > 1 ? (
        <SettingsRow
          label={translate('auto.components.settings.boardAutomation.projectLabel', 'Project')}
          control={
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={activeRepoId}
              onChange={(event) => setRepoId(event.target.value)}
              aria-label={translate(
                'auto.components.settings.boardAutomation.projectLabel',
                'Project'
              )}
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.displayName}
                </option>
              ))}
            </select>
          }
        />
      ) : null}

      <SettingsSubsectionHeader
        title={translate('auto.components.settings.boardAutomation.rulesTitle', 'Rules')}
        description={translate(
          'auto.components.settings.boardAutomation.rulesDescription',
          'Moving a workspace into a column dispatches the bound member. New rules start disabled.'
        )}
      />

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.settings.boardAutomation.empty',
            'No rules for this board yet.'
          )}
        </p>
      ) : null}

      {rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={rule.toStatusId}
              aria-label={translate(
                'auto.components.settings.boardAutomation.columnLabel',
                'Column'
              )}
              onChange={(event) =>
                void save(
                  rules.map((item) =>
                    item.id === rule.id ? { ...item, toStatusId: event.target.value } : item
                  )
                )
              }
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">→</span>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={rule.memberId}
              aria-label={translate(
                'auto.components.settings.boardAutomation.memberLabel',
                'Member'
              )}
              onChange={(event) =>
                void save(
                  rules.map((item) =>
                    item.id === rule.id ? { ...item, memberId: event.target.value } : item
                  )
                )
              }
            >
              {members.length === 0 ? (
                <option value={rule.memberId}>
                  {memberName.get(rule.memberId) ?? rule.memberId}
                </option>
              ) : (
                members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))
              )}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) =>
                  void save(
                    rules.map((item) =>
                      item.id === rule.id ? { ...item, enabled: checked } : item
                    )
                  )
                }
                aria-label={translate(
                  'auto.components.settings.boardAutomation.enableRule',
                  'Enable rule'
                )}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void save(rules.filter((item) => item.id !== rule.id))}
              >
                {translate('auto.components.settings.boardAutomation.remove', 'Remove')}
              </Button>
            </div>
          </div>
          <Textarea
            rows={2}
            value={rule.promptTemplate}
            onChange={(event) =>
              setRules(
                rules.map((item) =>
                  item.id === rule.id ? { ...item, promptTemplate: event.target.value } : item
                )
              )
            }
            onBlur={() => void save(rules)}
            placeholder={DEFAULT_TEMPLATE}
          />
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.boardAutomation.placeholders',
              'Placeholders: {{worktree}}, {{issue}}, {{status}}, {{worktreePath}}'
            )}
          </p>
        </div>
      ))}

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={members.length === 0}
          onClick={() =>
            void save([...rules, newRule(activeRepoId, statuses[0]!.id, members[0]!.id)])
          }
        >
          {translate('auto.components.settings.boardAutomation.add', 'Add rule')}
        </Button>
        {members.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.boardAutomation.needsMember',
              'Create a Member first: a rule dispatches one.'
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}
