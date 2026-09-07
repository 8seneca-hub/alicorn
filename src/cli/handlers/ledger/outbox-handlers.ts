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

function formatOutboxTotals(result: OutboxListResult): string {
  const counts = result.counts
  return counts
    ? `pending: ${counts.pending} | sent: ${counts.sent} | dead: ${counts.dead}`
    : `dead: ${result.deadCount}`
}

// Why totals can appear with no rows listed: `--dead` on a queue stalled behind a bad ledger URL
// prints "no dead rows", which reads as healthy while thousands of rows sit pending (LG3). An
// all-zero table stays quiet, so a genuinely empty outbox is not made noisy to catch that case.
function hasAnyRows(result: OutboxListResult): boolean {
  const counts = result.counts
  return counts ? counts.pending + counts.sent + counts.dead > 0 : result.deadCount > 0
}

function formatOutboxList(result: OutboxListResult, dead: boolean): string {
  const empty = dead ? 'no dead rows' : 'no pending rows'
  if (result.rows.length === 0) {
    return hasAnyRows(result) ? [formatOutboxTotals(result), empty].join('\n') : empty
  }
  return [formatOutboxTotals(result), OUTBOX_LIST_HEADER, ...result.rows.map(formatOutboxRow)].join(
    '\n'
  )
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
