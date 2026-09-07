import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalPositiveIntegerFlag, getRequiredStringFlag } from '../../flags'

type OutboxListRow = {
  id: string
  kind: string
  dedupeKey: string
  attempts: number
  lastError: string | null
  notBefore: string | null
  deadAt: string | null
  deadReason: string | null
  createdAt: string
}

type OutboxListResult = { rows: OutboxListRow[]; deadCount: number }

// Why: keeps a long transport error from blowing out the table row.
function truncateLastError(value: string | null): string {
  if (!value) {
    return ''
  }
  return value.length > 60 ? value.slice(0, 60) : value
}

function formatOutboxList(result: OutboxListResult): string {
  const lines = [`dead: ${result.deadCount}`]
  for (const row of result.rows) {
    lines.push(
      [
        row.id,
        row.kind,
        String(row.attempts),
        truncateLastError(row.lastError),
        row.deadReason ?? ''
      ].join(' | ')
    )
  }
  return lines.join('\n')
}

export const LEDGER_OUTBOX_HANDLERS: Record<string, CommandHandler> = {
  'ledger outbox': async ({ flags, client, json }) => {
    const result = await client.call<OutboxListResult>('ledger.outboxList', {
      dead: flags.get('dead') === true,
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatOutboxList)
  },

  'ledger outbox-requeue': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const result = await client.call<{ requeued: boolean }>('ledger.outboxRequeue', { id })
    printResult(result, json, (value) =>
      value.requeued ? `requeued ${id}` : `not dead, nothing to requeue: ${id}`
    )
  }
}
