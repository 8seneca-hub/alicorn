/**
 * The two authored fields that decide whether a level on this stage can do anything at all.
 *
 * `gateReasonFor` reads `reversibility` and `inheritedCost` before it looks at a policy, so a
 * screen that offers four levels without showing these offers four choices where there is one.
 * Both are authored on the stage in the workflow canvas and never inferred (ARCHITECTURE §7).
 */
import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import { inheritedCostLabel, reversibilityLabel } from '../workflow-canvas/workflow-canvas-labels'
import { AlicornInfoHint } from '../AlicornInfoHint'

function Fact({
  label,
  value,
  alarming
}: {
  label: string
  value: string
  alarming: boolean
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(alarming ? 'font-medium text-status-attention' : 'text-foreground')}>
        {value}
      </span>
    </span>
  )
}

export function AlicornStageGateFacts({ stage }: { stage: WorkflowStage }): React.JSX.Element {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <Fact
        label={translate('auto.components.alicorn.workflowCanvas.reversibility', 'Reversibility')}
        value={reversibilityLabel(stage.reversibility)}
        alarming={stage.reversibility === 'irreversible'}
      />
      <Fact
        label={translate('auto.components.alicorn.workflowCanvas.inheritedCost', 'Inherited cost')}
        value={inheritedCostLabel(stage.inheritedCost)}
        alarming={stage.inheritedCost === 'high'}
      />
      <AlicornInfoHint
        label={translate(
          'auto.components.alicorn.autonomy.stageFactsHintLabel',
          'What these two decide'
        )}
      >
        <p>
          {translate(
            'auto.components.alicorn.autonomy.stageFactsHint',
            'Both are authored on the stage in the workflow, never guessed from what it does — guessing wrong once is a production deploy.'
          )}
        </p>
        <p>
          {translate(
            'auto.components.alicorn.autonomy.stageFactsHintHardStop',
            'An irreversible stage, or one costly to undo, is a hard stop: it is read before any policy, so it gates at every level and no track record retires it.'
          )}
        </p>
      </AlicornInfoHint>
    </div>
  )
}
