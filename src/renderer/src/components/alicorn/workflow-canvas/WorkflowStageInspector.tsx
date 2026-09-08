import type { Member } from '../../../../../shared/alicorn/members'
import {
  INHERITED_COSTS,
  STAGE_KINDS,
  STAGE_REVERSIBILITY,
  type WorkflowStage
} from '../../../../../shared/alicorn/workflows'
import {
  inheritedCostLabel,
  issueLabel,
  reversibilityLabel,
  stageKindLabel
} from './workflow-canvas-labels'
import type { DraftIssue } from './workflow-draft-validation'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SettingsRow } from '../../settings/SettingsFormControls'
import { translate } from '@/i18n/i18n'

const UNASSIGNED = '__none__'

/**
 * Where a human authors what the gate reads.
 *
 * `reversibility` and `inheritedCost` are the two fields ARCHITECTURE §7 says are authored and
 * never inferred: `irreversible` makes the stage a hard stop that no track record retires. They
 * are plain selects with no default cleverness — the safe value is already the draft's default,
 * and anything that guessed the risky one would be guessing about a production deploy.
 *
 * Required checks are shown, not edited: until workflows have stages of their own to author them
 * on (v1.5) they are authored per project by an org admin, and never by the member being judged.
 */
export function WorkflowStageInspector({
  stage,
  members,
  issues,
  keyIsMeasured,
  onPatch,
  onRename,
  onMove,
  onRemove
}: {
  stage: WorkflowStage
  members: readonly Member[]
  issues: readonly DraftIssue[]
  /** True when the saved workflow already measured this key — renaming starts a new window (SK1). */
  keyIsMeasured: boolean
  onPatch: (patch: Partial<Omit<WorkflowStage, 'key' | 'ordinal'>>) => void
  onRename: (key: string) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <SettingsRow
        label={translate('auto.components.alicorn.workflowCanvas.stageName', 'Name')}
        control={
          <Input
            className="h-7 w-56 text-xs"
            value={stage.name}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        }
      />

      <SettingsRow
        alignTop
        label={translate('auto.components.alicorn.workflowCanvas.stageKey', 'Stage key')}
        description={
          keyIsMeasured
            ? translate(
                'auto.components.alicorn.workflowCanvas.stageKeyMeasured',
                'This key carries the stage track record. Renaming it starts an empty window; the evidence stays on the old key.'
              )
            : translate(
                'auto.components.alicorn.workflowCanvas.stageKeyDescription',
                'What the ledger measures this stage under. Lowercase letters, digits, dash and underscore.'
              )
        }
        control={
          <Input
            className="h-7 w-56 font-mono text-xs"
            value={stage.key}
            onChange={(event) => onRename(event.target.value)}
          />
        }
      />

      <EnumRow
        label={translate('auto.components.alicorn.workflowCanvas.stageKind', 'Runs as')}
        value={stage.kind}
        options={STAGE_KINDS}
        describe={stageKindLabel}
        onChange={(kind) => onPatch({ kind })}
      />

      {stage.kind === 'code' ? (
        <SettingsRow
          label={translate('auto.components.alicorn.workflowCanvas.codeCommand', 'Command')}
          control={
            <Input
              className="h-7 w-56 font-mono text-xs"
              value={stage.codeCommand ?? ''}
              onChange={(event) => onPatch({ codeCommand: event.target.value || null })}
            />
          }
        />
      ) : (
        <SettingsRow
          label={translate('auto.components.alicorn.workflowCanvas.member', 'Member')}
          control={
            <Select
              value={stage.memberId ?? UNASSIGNED}
              onValueChange={(next) => onPatch({ memberId: next === UNASSIGNED ? null : next })}
            >
              <SelectTrigger
                className="h-7 w-56 text-xs"
                aria-label={translate('auto.components.alicorn.workflowCanvas.member', 'Member')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED} className="text-xs">
                  {translate(
                    'auto.components.alicorn.workflowCanvas.noMember',
                    'No member assigned'
                  )}
                </SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id} className="text-xs">
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      )}

      <SettingsRow
        label={translate('auto.components.alicorn.workflowCanvas.columnId', 'Board column')}
        description={translate(
          'auto.components.alicorn.workflowCanvas.columnIdDescription',
          'The column whose move dispatches this stage. Several stages can share none.'
        )}
        control={
          <Input
            className="h-7 w-56 font-mono text-xs"
            value={stage.columnId ?? ''}
            onChange={(event) => onPatch({ columnId: event.target.value || null })}
          />
        }
      />

      <EnumRow
        label={translate('auto.components.alicorn.workflowCanvas.reversibility', 'Reversibility')}
        description={translate(
          'auto.components.alicorn.workflowCanvas.reversibilityDescription',
          'Authored, never inferred. An irreversible stage gates however good the track record is.'
        )}
        value={stage.reversibility}
        options={STAGE_REVERSIBILITY}
        describe={reversibilityLabel}
        onChange={(reversibility) => onPatch({ reversibility })}
      />

      <EnumRow
        label={translate('auto.components.alicorn.workflowCanvas.inheritedCost', 'Inherited cost')}
        description={translate(
          'auto.components.alicorn.workflowCanvas.inheritedCostDescription',
          'What undoing this stage costs everyone downstream. Also authored, also never inferred.'
        )}
        value={stage.inheritedCost}
        options={INHERITED_COSTS}
        describe={inheritedCostLabel}
        onChange={(inheritedCost) => onPatch({ inheritedCost })}
      />

      <SettingsRow
        alignTop
        label={translate(
          'auto.components.alicorn.workflowCanvas.requiredChecks',
          'Required checks'
        )}
        description={translate(
          'auto.components.alicorn.workflowCanvas.requiredChecksDescription',
          'Authored per project by an admin, so a member cannot loosen what it is judged by. Shown here, edited in the project settings.'
        )}
        control={
          <span className="text-muted-foreground text-xs">
            {stage.requiredChecks.length === 0
              ? translate('auto.components.alicorn.workflowCanvas.noRequiredChecks', 'None')
              : stage.requiredChecks.map((check) => check.kind).join(', ')}
          </span>
        }
      />

      {issues.length > 0 ? (
        <ul className="text-destructive space-y-0.5 text-xs">
          {issues.map((issue) => (
            <li key={issue.code}>{issueLabel(issue.code)}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onMove(-1)}>
          {translate('auto.components.alicorn.workflowCanvas.moveUp', 'Move up')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onMove(1)}>
          {translate('auto.components.alicorn.workflowCanvas.moveDown', 'Move down')}
        </Button>
        <Button size="sm" variant="destructive" onClick={onRemove}>
          {translate('auto.components.alicorn.workflowCanvas.removeStage', 'Remove stage')}
        </Button>
      </div>
    </div>
  )
}

function EnumRow<T extends string>({
  label,
  description,
  value,
  options,
  describe,
  onChange
}: {
  label: string
  description?: string
  value: T
  options: readonly T[]
  describe: (value: T) => string
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <SettingsRow
      alignTop={description !== undefined}
      label={label}
      description={description}
      control={
        <Select value={value} onValueChange={(next) => onChange(next as T)}>
          <SelectTrigger className="h-7 w-56 text-xs" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {describe(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
