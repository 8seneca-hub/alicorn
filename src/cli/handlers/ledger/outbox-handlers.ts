import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../../flags'
import { RuntimeClientError } from '../../runtime/types'
import type { OutboxListResult, OutboxListRow } from '../../../shared/alicorn/ledger-outbox-view'

const OUTBOX_LIST_HEADER = 'id | kind | attempts | last_error | dead_reason | dead_at'

// Why: keeps a long transport error from blowing out the table row; the ellipsis marks truncation.
function truncateLastError(value: string | null): string {
  if (!value) {
    return ''
  }
  return value.length > 60 ? `${value.slice(0, 60)}…` : value
}

function formatOutboxRow(row: OutboxListRow): string {
  return [
    row.id,
    row.kind,
    String(row.attempts),
    truncateLastError(row.lastError),
    row.deadReason ?? '',
    row.deadAt ?? ''
  ].join(' | ')
}

function formatOutboxList(result: OutboxListResult, dead: boolean): string {
  if (result.rows.length === 0) {
    return dead ? 'no dead rows' : 'no pending rows'
  }
  return [
    `dead: ${result.deadCount}`,
    OUTBOX_LIST_HEADER,
    ...result.rows.map(formatOutboxRow)
  ].join('\n')
}

export const LEDGER_OUTBOX_HANDLERS: Record<string, CommandHandler> = {
  'ledger outbox': async ({ flags, client, json }) => {
    const dead = flags.get('dead') === true
    const result = await client.call<OutboxListResult>('ledger.outboxList', {
      dead,
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, (value) => formatOutboxList(value, dead))
  },

  'ledger outbox-requeue': async ({ flags, client, json }) => {
    const id = getOptionalStringFlag(flags, 'id')
    const all = flags.get('all') === true
    if (Boolean(id) === all) {
      throw new RuntimeClientError('invalid_argument', 'Provide exactly one of --id or --all')
    }
    if (all) {
      const kind = getOptionalStringFlag(flags, 'kind')
      const result = await client.call<{ requeuedCount: number }>('ledger.outboxRequeue', {
        all: true,
        kind
      })
      printResult(result, json, (value) => `requeued ${value.requeuedCount} row(s)`)
      return
    }
    const result = await client.call<{ requeued: boolean }>('ledger.outboxRequeue', { id })
    printResult(result, json, (value) =>
      value.requeued ? `requeued ${id}` : `not dead, nothing to requeue: ${id}`
    )
  }
}
