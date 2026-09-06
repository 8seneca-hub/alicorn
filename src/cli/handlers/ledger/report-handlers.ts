import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalStringFlag } from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import type { InterruptionsReport } from '../../../shared/alicorn/ledger-report'

function formatInterruptionsReport(report: InterruptionsReport): string {
  const headline = `interruptions per completed task: ${report.perCompletedTask.toFixed(2)} (${report.interruptions} / ${report.completedTasks})`
  const table = [
    'stage | completed | interruptions | per task',
    ...report.byStage.map(
      (stage) =>
        `${stage.stageKey} | ${stage.completedTasks} | ${stage.interruptions} | ${stage.perCompletedTask.toFixed(2)}`
    )
  ]
  return [headline, '', ...table, '', `excluded: ${report.excluded.join(', ')}`].join('\n')
}

export const LEDGER_REPORT_HANDLERS: Record<string, CommandHandler> = {
  'ledger report': async ({ flags, client, json }) => {
    let result
    try {
      result = await client.call<InterruptionsReport>('ledger.report', {
        stageKey: getOptionalStringFlag(flags, 'stage'),
        projectId: getOptionalStringFlag(flags, 'project'),
        memberId: getOptionalStringFlag(flags, 'member'),
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
