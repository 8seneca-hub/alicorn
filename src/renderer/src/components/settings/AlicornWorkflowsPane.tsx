import { useState } from 'react'
import type { WorkflowStage } from '../../../../shared/alicorn/workflows'
import { WorkflowCanvas, type CanvasSelection } from '../alicorn/workflow-canvas/WorkflowCanvas'
import { WorkflowStageInspector } from '../alicorn/workflow-canvas/WorkflowStageInspector'
import { WorkflowTransitionInspector } from '../alicorn/workflow-canvas/WorkflowTransitionInspector'
import { issueLabel } from '../alicorn/workflow-canvas/workflow-canvas-labels'
import { issuesForStage } from '../alicorn/workflow-canvas/workflow-draft-validation'
import { useWorkflowEditor } from '../alicorn/workflow-canvas/use-workflow-editor'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

const UNCONFIGURED = 'control_plane_unconfigured'
const FEATURE_DELIVERY = 'feature-delivery'

function nextStageKey(stages: readonly WorkflowStage[]): string {
  let n = stages.length + 1
  while (stages.some((stage) => stage.key === `stage-${n}`)) {
    n += 1
  }
  return `stage-${n}`
}

/**
 * WF2's canvas: a workflow drawn as stages and edges, with the correction edge first-class.
 *
 * A workflow is not the default path — `execution_strategy: single` is — so this is a settings
 * surface an author opens deliberately, not something the board puts in anyone's way.
 */
export function AlicornWorkflowsPane(): React.JSX.Element {
  const repos = useAppStore((store) => store.repos)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [selection, setSelection] = useState<CanvasSelection>(null)
  const projectId = repoId ?? repos[0]?.id ?? null
  const editor = useWorkflowEditor(projectId)

  if (editor.error === UNCONFIGURED) {
    return (
      <SettingsRow
        alignTop
        label={translate(
          'auto.components.settings.alicornWorkflows.unconfiguredTitle',
          'Control plane not configured'
        )}
        description={translate(
          'auto.components.settings.alicornWorkflows.unconfiguredDescription',
          'Set ALICORN_CONTROL_API_URL and ALICORN_LOCAL_API_TOKEN, then reopen Settings. See docs/alicorn/LOCAL-DEV.md.'
        )}
        control={
          <Button variant="outline" size="sm" onClick={() => void editor.reload()}>
            {translate('auto.components.settings.alicornWorkflows.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  const { draft, saved, issues } = editor
  const selectedStage =
    selection?.kind === 'stage'
      ? (draft?.stages.find((stage) => stage.key === selection.key) ?? null)
      : null
  const selectedTransition =
    selection?.kind === 'transition'
      ? (draft?.transitions.find((t) => t.from === selection.from && t.to === selection.to) ?? null)
      : null

  return (
    <div className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.alicornWorkflows.title', 'Workflows')}
        description={translate(
          'auto.components.settings.alicornWorkflows.description',
          'Stages, who runs them, and the edges between them — including findings going back to the author.'
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={projectId ?? ''} onValueChange={setRepoId}>
          <SelectTrigger
            className="h-7 w-56 text-xs"
            aria-label={translate('auto.components.settings.alicornWorkflows.project', 'Project')}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.settings.alicornWorkflows.project',
                'Project'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {repos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id} className="text-xs">
                {repo.displayName || repo.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={saved?.id ?? ''} onValueChange={(id) => void editor.open(id)}>
          <SelectTrigger
            className="h-7 w-56 text-xs"
            aria-label={translate('auto.components.settings.alicornWorkflows.workflow', 'Workflow')}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.settings.alicornWorkflows.workflow',
                'Workflow'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {editor.summaries.map((summary) => (
              <SelectItem key={summary.id} value={summary.id} className="text-xs">
                {summary.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          disabled={!projectId}
          onClick={() => void editor.startFromTemplate(FEATURE_DELIVERY)}
        >
          {translate(
            'auto.components.settings.alicornWorkflows.fromTemplate',
            'New from Feature delivery'
          )}
        </Button>
      </div>

      {editor.error && editor.error !== UNCONFIGURED ? (
        <p className="text-destructive text-xs">{issueLabel(editor.error)}</p>
      ) : null}

      {editor.loading ? (
        <p className="text-muted-foreground text-xs">
          {translate('auto.components.settings.alicornWorkflows.loading', 'Loading workflows…')}
        </p>
      ) : null}

      {!draft ? (
        <p className="text-muted-foreground text-xs">
          {translate(
            'auto.components.settings.alicornWorkflows.pickOne',
            'Pick a workflow to draw it, or start one from the Feature delivery template.'
          )}
        </p>
      ) : (
        <div className="space-y-3">
          <SettingsRow
            label={translate('auto.components.settings.alicornWorkflows.name', 'Name')}
            control={
              <Input
                className="h-7 w-56 text-xs"
                value={draft.name}
                onChange={(event) => editor.setName(event.target.value)}
              />
            }
          />

          <WorkflowCanvas
            stages={draft.stages}
            transitions={draft.transitions}
            members={editor.members}
            issues={issues}
            selection={selection}
            onSelect={setSelection}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => editor.addStage(nextStageKey(draft.stages))}
            >
              {translate('auto.components.settings.alicornWorkflows.addStage', 'Add stage')}
            </Button>
            <Button
              size="sm"
              disabled={editor.saving || issues.length > 0}
              onClick={() => void editor.save()}
            >
              {translate('auto.components.settings.alicornWorkflows.save', 'Save workflow')}
            </Button>
            {saved ? (
              <span className="text-muted-foreground text-xs">
                {translate('auto.components.settings.alicornWorkflows.version', 'Version')}{' '}
                {saved.version}
              </span>
            ) : null}
          </div>

          {editor.renamedKeys.length > 0 ? (
            <p className="text-status-attention text-xs">
              {translate(
                'auto.components.settings.alicornWorkflows.renameWarning',
                'These stage keys carry a track record that the renamed stages will not inherit:'
              )}{' '}
              <span className="font-mono">{editor.renamedKeys.join(', ')}</span>
            </p>
          ) : null}

          {issues.length > 0 ? (
            <ul className="text-destructive space-y-0.5 text-xs">
              {issues.map((issue) => (
                <li key={`${issue.code}-${JSON.stringify(issue.target)}`}>
                  {issueLabel(issue.code)}
                </li>
              ))}
            </ul>
          ) : null}

          {selectedStage ? (
            <WorkflowStageInspector
              stage={selectedStage}
              members={editor.members}
              issues={issuesForStage(issues, selectedStage.key)}
              keyIsMeasured={saved?.stages.some((s) => s.key === selectedStage.key) ?? false}
              onPatch={(patch) => editor.patchStage(selectedStage.key, patch)}
              onRename={(key) => {
                editor.renameStage(selectedStage.key, key)
                setSelection({ kind: 'stage', key })
              }}
              onMove={(delta) => editor.moveStage(selectedStage.key, delta)}
              onRemove={() => {
                editor.removeStage(selectedStage.key)
                setSelection(null)
              }}
            />
          ) : null}

          <WorkflowTransitionInspector
            stages={draft.stages}
            transitions={draft.transitions}
            issues={issues}
            selected={selectedTransition}
            onSelect={(transition) =>
              setSelection({ kind: 'transition', from: transition.from, to: transition.to })
            }
            onUpsert={(transition) => {
              editor.upsertTransition(transition)
              setSelection({ kind: 'transition', from: transition.from, to: transition.to })
            }}
            onRemove={(from, to) => {
              editor.removeTransition(from, to)
              setSelection(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
