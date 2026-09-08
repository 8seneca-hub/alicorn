import type {
  InheritedCost,
  StageKind,
  StageReversibility,
  TransitionKind,
  TriggerKind
} from '../../../../../shared/alicorn/workflows'
import { translate } from '@/i18n/i18n'

export function reversibilityLabel(value: StageReversibility): string {
  switch (value) {
    case 'free':
      return translate('auto.components.alicorn.workflowCanvas.reversibilityFree', 'Reversible')
    case 'contained':
      return translate('auto.components.alicorn.workflowCanvas.reversibilityContained', 'Contained')
    case 'irreversible':
      return translate(
        'auto.components.alicorn.workflowCanvas.reversibilityIrreversible',
        'Irreversible'
      )
  }
}

export function inheritedCostLabel(value: InheritedCost): string {
  return value === 'high'
    ? translate('auto.components.alicorn.workflowCanvas.costHigh', 'Costly to undo')
    : translate('auto.components.alicorn.workflowCanvas.costLow', 'Cheap to undo')
}

export function stageKindLabel(value: StageKind): string {
  return value === 'code'
    ? translate('auto.components.alicorn.workflowCanvas.stageKindCode', 'Code stage')
    : translate('auto.components.alicorn.workflowCanvas.stageKindWorker', 'Member stage')
}

export function transitionKindLabel(value: TransitionKind): string {
  return value === 'correction'
    ? translate('auto.components.alicorn.workflowCanvas.edgeCorrection', 'Correction')
    : translate('auto.components.alicorn.workflowCanvas.edgeForward', 'Forward')
}

export function triggerLabel(value: TriggerKind): string {
  switch (value) {
    case 'on_success':
      return translate('auto.components.alicorn.workflowCanvas.triggerSuccess', 'On success')
    case 'on_failure':
      return translate('auto.components.alicorn.workflowCanvas.triggerFailure', 'On failure')
    case 'manual':
      return translate('auto.components.alicorn.workflowCanvas.triggerManual', 'Manual')
  }
}

/** Reads back the contract's rejection codes, which arrive verbatim from a 400 as well as locally. */
export function issueLabel(code: string): string {
  switch (code) {
    case 'correction_edge_must_return':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueCorrectionMustReturn',
        'A correction edge has to go back to an earlier stage.'
      )
    case 'forward_edge_must_not_return':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueForwardMustNotReturn',
        'This edge goes back to an earlier stage, so it is a correction, not a forward edge.'
      )
    case 'ambiguous_trigger':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueAmbiguousTrigger',
        'Two edges leave this stage on the same trigger, so dispatch would be a coin toss.'
      )
    case 'duplicate_transition':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueDuplicateTransition',
        'These two stages already have an edge between them.'
      )
    case 'self_transition':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueSelfTransition',
        'An edge cannot start and end on the same stage.'
      )
    case 'unknown_stage_key':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueUnknownStage',
        'This edge points at a stage that is not on the canvas.'
      )
    case 'duplicate_stage_key':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueDuplicateStageKey',
        'Two stages share this key, so the ledger could not tell them apart.'
      )
    case 'invalid_stage_key':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueInvalidStageKey',
        'A stage key is lowercase letters, digits, dash and underscore.'
      )
    case 'code_stage_requires_command':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueCodeStageCommand',
        'A code stage needs the command it runs.'
      )
    case 'code_stage_takes_no_member':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueCodeStageMember',
        'A code stage runs no model, so it takes no member.'
      )
    case 'name_required':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueNameRequired',
        'The workflow needs a name.'
      )
    case 'stages_required':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueStagesRequired',
        'A workflow needs at least one stage.'
      )
    case 'version_conflict':
      return translate(
        'auto.components.alicorn.workflowCanvas.issueVersionConflict',
        'Someone else saved this workflow while you were editing. Reload before saving again.'
      )
    default:
      return code
  }
}
