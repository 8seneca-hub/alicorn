/**
 * What the composer's three non-obvious fields actually decide.
 *
 * They live beside the dialog rather than inside it because each one is a paragraph of rule, and a
 * rule inlined between a <Select> and its trail is a rule nobody finds when it changes.
 *
 * Every sentence here has to be true of the code that enforces it: the stage rules are
 * `gateReasonFor`, the token figure is the brief's ~10–15× for `orchestrated`, and a null model is
 * `AlicornModelPicker`'s "Default for this backend".
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { AlicornInfoHint } from '../AlicornInfoHint'

export function WorkflowFieldHint({
  workflowName,
  stageNames
}: {
  /** The chosen workflow, or null for "No workflow". */
  workflowName: string | null
  /** In running order. Empty while the full workflow is still being read. */
  stageNames: readonly string[]
}): React.JSX.Element {
  return (
    <AlicornInfoHint
      label={translate('auto.components.alicorn.newTask.workflowHintLabel', 'What a workflow does')}
    >
      {workflowName ? (
        <p>
          {stageNames.length > 0
            ? translate(
                'auto.components.alicorn.newTask.workflowHintStages',
                'Binds this task to {{workflow}} and its stages: {{stages}}.',
                { workflow: workflowName, stages: stageNames.join(' → ') }
              )
            : translate(
                'auto.components.alicorn.newTask.workflowHintBound',
                'Binds this task to {{workflow}} and its stages.',
                { workflow: workflowName }
              )}
        </p>
      ) : (
        <p>
          {translate(
            'auto.components.alicorn.newTask.workflowHintNone',
            'No workflow is a raw session on the brief: no stages, no hand-off, nothing to gate at. Most work wants this.'
          )}
        </p>
      )}
      <p>
        {workflowName
          ? translate(
              'auto.components.alicorn.newTask.workflowHintGates',
              'Every move between stages is checked: a stage gates when it is irreversible, carries inherited cost, or the project authored it always_gate — or authored nothing at all. Choosing “No workflow” instead gives a raw session with no stages and no hand-off.'
            )
          : translate(
              'auto.components.alicorn.newTask.workflowHintChoose',
              'Choosing a workflow instead binds the task to its stages and the gates between them — authored on the workflow, never by whoever works the task.'
            )}
      </p>
    </AlicornInfoHint>
  )
}

export function ExecutionStrategyFieldHint(): React.JSX.Element {
  return (
    <AlicornInfoHint
      label={translate(
        'auto.components.alicorn.newTask.strategyHintLabel',
        'What execution strategy decides'
      )}
    >
      <p>
        {translate(
          'auto.components.alicorn.newTask.strategyHintSingle',
          'single — one agent, one session, working from this brief. The default, and what about nine tickets in ten want.'
        )}
      </p>
      <p>
        {translate(
          'auto.components.alicorn.newTask.strategyHintOrchestrated',
          'orchestrated — a lead splits the ticket and briefs subagents, each on a fresh context. Roughly 10–15× the tokens for the same ticket: a trade, not an upgrade.'
        )}
      </p>
    </AlicornInfoHint>
  )
}

export function ModelFieldHint(): React.JSX.Element {
  return (
    <AlicornInfoHint
      label={translate(
        'auto.components.alicorn.newTask.modelHintLabel',
        'What the model applies to'
      )}
    >
      <p>
        {translate(
          'auto.components.alicorn.newTask.modelHintScope',
          'Set on this task, not on the member — the same reviewer reads a one-line fix and a schema migration.'
        )}
      </p>
      <p>
        {translate(
          'auto.components.alicorn.newTask.modelHintDefault',
          'Left on “Default for this backend”, nothing is sent and each run takes whatever its own backend picks.'
        )}
      </p>
    </AlicornInfoHint>
  )
}
