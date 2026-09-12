/**
 * A receipt: what a change did, and the exact call that undoes it.
 *
 * PRODUCT-ARCHITECTURE §3 — every mutation answers with a receipt. Prose alone is not enough for a
 * UI: "set them back on task tsk_x" is a sentence a human can act on and a button cannot. So a
 * write also emits this, machine-readable, and the assistant renders it as a row with an Undo.
 *
 * It rides on the first line of the tool result under a fixed prefix, for two reasons. The client
 * bounds tool output and keeps the *head*, so a leading line survives truncation that would eat a
 * trailing one. And it stays inside the text content, so nothing depends on a protocol revision
 * later than the 2024-11-05 this server pins.
 *
 * The undo names an **action the app performs**, never a tool the agent can call. Deletion is not
 * in the agent's tool set on purpose (PRODUCT-ARCHITECTURE §5 keeps it to create-a-task, move-one,
 * add-a-member), so a receipt that named `alicorn_delete_task` would be inviting the model to
 * reach for a power it does not have. Undo is the human's, executed by the app.
 */

export const ALICORN_UNDO_ACTIONS = [
  'task.delete',
  'task.update',
  'member.delete',
  'project.delete'
] as const
export type AlicornUndoAction = (typeof ALICORN_UNDO_ACTIONS)[number]

export const ALICORN_RECEIPT_PREFIX = 'ALICORN-RECEIPT '

export type AlicornReceipt = {
  /** One sentence, already written for a human: "Moved PAY-12 to In review". */
  summary: string
  /** What the app would do to reverse this, and with what. Null when nothing can. */
  undo: { action: AlicornUndoAction; args: Record<string, unknown> } | null
}

export function formatAlicornReceiptLine(receipt: AlicornReceipt): string {
  return `${ALICORN_RECEIPT_PREFIX}${JSON.stringify(receipt)}`
}

/**
 * Reads a receipt out of tool output.
 *
 * Only the first line is considered, and only under the exact prefix: a receipt recovered from
 * anywhere in the text would let a model that quoted one back conjure an Undo button for a change
 * that never happened.
 */
export function parseAlicornReceipt(output: string): AlicornReceipt | null {
  const newline = output.indexOf('\n')
  const firstLine = newline === -1 ? output : output.slice(0, newline)
  if (!firstLine.startsWith(ALICORN_RECEIPT_PREFIX)) {
    return null
  }
  try {
    const parsed = JSON.parse(firstLine.slice(ALICORN_RECEIPT_PREFIX.length)) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const candidate = parsed as Partial<AlicornReceipt>
    if (typeof candidate.summary !== 'string' || candidate.summary.length === 0) {
      return null
    }
    const undo = candidate.undo
    if (undo === null || undo === undefined) {
      return { summary: candidate.summary, undo: null }
    }
    if (
      !ALICORN_UNDO_ACTIONS.includes(undo.action as AlicornUndoAction) ||
      !undo.args ||
      typeof undo.args !== 'object'
    ) {
      return null
    }
    return { summary: candidate.summary, undo: { action: undo.action, args: undo.args } }
  } catch {
    return null
  }
}
