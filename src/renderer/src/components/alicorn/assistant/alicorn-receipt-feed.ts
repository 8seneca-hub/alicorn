/**
 * The changes this session made, newest first, each with the call that reverses it.
 *
 * Read out of the transcript rather than tracked separately: the transcript is what actually
 * happened, and a parallel list would disagree with it the moment a session resumed on another
 * machine or the panel remounted.
 *
 * Keyed by message and position so re-rendering the same transcript yields the same rows, and so
 * undoing one does not renumber the others.
 */
import type { NativeChatMessage } from '../../../../../shared/native-chat-types'
import { parseAlicornReceipt, type AlicornReceipt } from '../../../../../shared/alicorn/receipt'

export type ReceiptEntry = AlicornReceipt & { id: string }

export function collectReceipts(messages: readonly NativeChatMessage[]): ReceiptEntry[] {
  const entries: ReceiptEntry[] = []
  for (const message of messages) {
    message.blocks.forEach((block, index) => {
      if (block.type !== 'tool-result' || block.isError) {
        return
      }
      const receipt = parseAlicornReceipt(block.output)
      if (receipt) {
        entries.push({ ...receipt, id: `${message.id}:${index}` })
      }
    })
  }
  return entries.toReversed()
}
