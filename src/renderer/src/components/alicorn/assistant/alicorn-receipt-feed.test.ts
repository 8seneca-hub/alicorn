import { describe, expect, it } from 'vitest'
import { collectReceipts } from './alicorn-receipt-feed'
import { formatAlicornReceiptLine } from '../../../../../shared/alicorn/receipt'
import type { NativeChatMessage } from '../../../../../shared/native-chat-types'

function message(id: string, outputs: { output: string; isError?: boolean }[]): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    timestamp: 0,
    source: 'transcript',
    blocks: outputs.map((entry) => ({
      type: 'tool-result' as const,
      output: entry.output,
      isError: entry.isError ?? false
    }))
  }
}

const created = {
  summary: 'Created task #1',
  undo: { action: 'task.delete' as const, args: { taskId: 'tsk_1' } }
}
const moved = {
  summary: 'Updated task #1 — column',
  undo: { action: 'task.update' as const, args: { taskId: 'tsk_1', column: 'todo' } }
}

describe('the receipt feed', () => {
  it('reads receipts out of the transcript, newest first', () => {
    const entries = collectReceipts([
      message('m1', [{ output: `${formatAlicornReceiptLine(created)}\nCreated it.` }]),
      message('m2', [{ output: `${formatAlicornReceiptLine(moved)}\nMoved it.` }])
    ])
    expect(entries.map((entry) => entry.summary)).toEqual([moved.summary, created.summary])
  })

  it('ignores output that carries no receipt, and plain prose', () => {
    expect(collectReceipts([message('m1', [{ output: 'Listed 3 projects.' }])])).toEqual([])
  })

  // A failed call changed nothing, so offering to undo it would be offering a lie.
  it('ignores a receipt on a failed call', () => {
    const entries = collectReceipts([
      message('m1', [{ output: formatAlicornReceiptLine(created), isError: true }])
    ])
    expect(entries).toEqual([])
  })

  it('gives each row a stable id, so undoing one does not renumber the rest', () => {
    const messages = [
      message('m1', [
        { output: formatAlicornReceiptLine(created) },
        { output: formatAlicornReceiptLine(moved) }
      ])
    ]
    expect(collectReceipts(messages).map((entry) => entry.id)).toEqual(['m1:1', 'm1:0'])
    expect(collectReceipts(messages).map((entry) => entry.id)).toEqual(['m1:1', 'm1:0'])
  })
})
