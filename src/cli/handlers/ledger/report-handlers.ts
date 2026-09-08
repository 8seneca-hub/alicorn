import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalStringFlag } from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import type { InterruptionsReport } from '../../../shared/alicorn/ledger-report'

const COMPLETED_TASK_DEFINITION_LABELS: Record<
  InterruptionsReport['completedTaskDefinition'],
  string
> = {
  any_successful_step: 'a task with at least one successful step',
  terminal_stage_succeeded: 'a task whose terminal stage succeeded',
  no_failed_step_outstanding: 'a task with no failed step outstanding'
}

function formatInterruptionsReport(report: InterruptionsReport): string {
  const headline = `interruptions per completed task: ${report.perCompletedTask.toFixed(2)} (${report.interruptions} / ${report.completedTasks})`
  // Why both lines: the loose count is the denominator this report shipped with, and it flatters us
  // — failed steps inflate it. Printing them side by side makes a divergence visible (LG5).
  const loose = `per task touched (loose): ${report.perTaskTouched.toFixed(2)} (${report.interruptions} / ${report.tasksTouched})`
  const definition = `completed = ${COMPLETED_TASK_DEFINITION_LABELS[report.completedTaskDefinition]}; touched = any settled outcome`
  const table = [
    'stage | completed | touched | interruptions | per completed | per touched',
    ...report.byStage.map(
      (stage) =>
        `${stage.stageKey} | ${stage.completedTasks} | ${stage.tasksTouched} | ${stage.interruptions} | ${stage.perCompletedTask.toFixed(2)} | ${stage.perTaskTouched.toFixed(2)}`
    )
  ]
  return [
    headline,
    loose,
    definition,
    '',
    ...table,
    '',
    `excluded: ${report.excluded.join(', ')}`
  ].join('\n')
}

export const LEDGER_REPORT_HANDLERS: Record<string, CommandHandler> = {
  'ledger report': async ({ flags, client, json }) => {
    let result
    try {
      result = await client.call<InterruptionsReport>('ledger.report', {
        stageKey: getOptionalStringFlag(flags, 'stage'),
        projectId: getOptionalStringFlag(flags, 'project'),
        memberId: getOptionalStringFlag(flags, 'member'),
        runId: getOptionalStringFlag(flags, 'run'),
        executionStrategy: getOptionalStringFlag(flags, 'strategy'),
        since: getOptionalStringFlag(flags, 'since'),
        until: getOptionalStringFlag(flags, 'until')
      })
    } catch (error) {
      if (error instanceof RuntimeClientError && error.code === 'control_plane_unconfigured') {
        throw new RuntimeClientError(
          'control_plane_unconfigured',
          'Alicorn control plane is not configured. Set ALICORN_CONTROL_API_URL and ALICORN_LOCAL_API_TOKEN — see docs/alicorn/LOCAL-DEV.md.'
        )
      }
      throw error
    }
    printResult(result, json, formatInterruptionsReport)
  }
}
