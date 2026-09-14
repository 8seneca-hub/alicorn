/**
 * What each autonomy level stores, and what the evaluator does with it.
 *
 * A level is a reading of `(mode, minRuns, minAcceptRate)` rather than a field of its own
 * (`autonomy-levels.ts`), so the row's one-line detail cannot say which of those three it moves —
 * and the difference between L1 and L2 is exactly that. These are the mapping, spelled out.
 *
 * The last sentence of L3 is the one people assume away: `gateReasonFor` reads `reversibility` and
 * `inheritedCost` *before* it looks at a policy, so a hard stop gates at every level.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { NEVER_GATE_DAYS, type AutonomyLevel } from '../../../../../shared/alicorn/autonomy-levels'
import { AlicornInfoHint } from '../AlicornInfoHint'

function levelLines(level: AutonomyLevel): string[] {
  switch (level) {
    case 'L0':
      return [
        translate(
          'auto.components.alicorn.autonomy.hintL0',
          'Stores always_gate. Every hand-off out of this stage is proposed and waits for you, whatever the ledger says.'
        )
      ]
    case 'L1':
      return [
        translate(
          'auto.components.alicorn.autonomy.hintL1',
          'Stores evidence with no bar to clear — 0 runs, 0% accepted. Reversible work runs the moment it is ready, because a reversible step does not need a track record to be worth running.'
        ),
        translate(
          'auto.components.alicorn.autonomy.hintL1Hard',
          'Anything irreversible is still proposed: reversibility is read before any policy, so no level reaches it.'
        )
      ]
    case 'L2':
      return [
        translate(
          'auto.components.alicorn.autonomy.hintL2',
          'Stores evidence at a bar. The step runs on its own and tells you after, but only once the ledger holds enough accepted runs for this member on this stage — the bar is shown under the level.'
        ),
        translate(
          'auto.components.alicorn.autonomy.hintL2Earn',
          'Evidence only accumulates by running gated, so a new stage sits here doing nothing until it has a record.'
        )
      ]
    case 'L3':
      return [
        translate(
          'auto.components.alicorn.autonomy.hintL3',
          'Stores never_gate, and it lapses after {{days}} days — a standing exception that never expires is the one thing the policy refuses.',
          { days: NEVER_GATE_DAYS }
        ),
        translate(
          'auto.components.alicorn.autonomy.hintL3Hard',
          'Hard stops still gate here. A stage that is irreversible or carries inherited cost is read before any policy, so L3 never reaches it.'
        )
      ]
  }
}

export function AlicornAutonomyLevelHint({ level }: { level: AutonomyLevel }): React.JSX.Element {
  return (
    <AlicornInfoHint
      label={translate('auto.components.alicorn.autonomy.hintLabel', 'What {{level}} stores', {
        level
      })}
    >
      {levelLines(level).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </AlicornInfoHint>
  )
}
