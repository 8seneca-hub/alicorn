import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'

type BoardAutomationStatusPayload = {
  killed: boolean
  globalDisabledAt: string | null
  globalDisabledBy: string | null
  boardDisabledAt: string | null
  boardDisabledBy: string | null
  lastRefusal: { outcome: string; at: string; toStatusId: string } | null
}

function describeStatus(status: BoardAutomationStatusPayload): string {
  const lines = [`Board automation: ${status.killed ? 'stopped' : 'running'}`]
  if (status.globalDisabledAt) {
    lines.push(
      `  stopped globally by ${status.globalDisabledBy ?? 'unknown'} at ${status.globalDisabledAt}`
    )
  }
  if (status.boardDisabledAt) {
    lines.push(
      `  stopped for this board by ${status.boardDisabledBy ?? 'unknown'} at ${status.boardDisabledAt}`
    )
  }
  // Why surface this: "running but nothing happens" is the confusing state, and the last refusal is
  // the answer to it.
  if (status.lastRefusal) {
    lines.push(
      `  last refusal: ${status.lastRefusal.outcome} on ${status.lastRefusal.toStatusId} at ${status.lastRefusal.at}`
    )
  }
  return lines.join('\n')
}

export const BOARD_AUTOMATION_HANDLERS: Record<string, CommandHandler> = {
  'board-automation status': async ({ flags, client, json }) => {
    const result = await client.call<BoardAutomationStatusPayload>('boardAutomation.status', {
      repoId: getRequiredStringFlag(flags, 'repo')
    })
    printResult(result, json, describeStatus)
  },

  'board-automation stop': async ({ flags, client, json }) => {
    const repoId = getOptionalStringFlag(flags, 'repo')
    const result = await client.call<{ scope: string; killed: boolean }>(
      'boardAutomation.setKilled',
      { killed: true, ...(repoId ? { repoId } : {}) }
    )
    printResult(result, json, (r) => `Board automation stopped for ${r.scope}.`)
  },

  'board-automation resume': async ({ flags, client, json }) => {
    const repoId = getOptionalStringFlag(flags, 'repo')
    const result = await client.call<{ scope: string; killed: boolean }>(
      'boardAutomation.setKilled',
      { killed: false, ...(repoId ? { repoId } : {}) }
    )
    printResult(result, json, (r) => `Board automation resumed for ${r.scope}.`)
  }
}
