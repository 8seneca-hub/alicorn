import { describe, expect, it } from 'vitest'
import { ALICORN_RECEIPT_PREFIX, formatAlicornReceiptLine, parseAlicornReceipt } from './receipt'

const RECEIPT = {
  summary: 'Moved PAY-12 to In review',
  undo: { action: 'task.update' as const, args: { taskId: 'tsk_1', column: 'in-progress' } }
}

describe('a receipt on the wire', () => {
  it('round-trips through the line it rides on', () => {
    expect(parseAlicornReceipt(formatAlicornReceiptLine(RECEIPT))).toEqual(RECEIPT)
  })

  it('is read from the head, so bounded output does not lose it', () => {
    const output = `${formatAlicornReceiptLine(RECEIPT)}\nMoved it.\n\n{"task":{}}`
    expect(parseAlicornReceipt(output)).toEqual(RECEIPT)
  })

  it('carries a change that cannot be reversed as an explicit null', () => {
    const listed = { summary: 'Listed 4 projects', undo: null }
    expect(parseAlicornReceipt(formatAlicornReceiptLine(listed))).toEqual(listed)
  })

  // A model that quotes a receipt back must not conjure an Undo for a change that never happened.
  it('ignores a receipt that is not the first line', () => {
    expect(
      parseAlicornReceipt(`Here is what I did:\n${formatAlicornReceiptLine(RECEIPT)}`)
    ).toBeNull()
  })

  it('refuses malformed and half-formed receipts', () => {
    expect(parseAlicornReceipt('no receipt here')).toBeNull()
    expect(parseAlicornReceipt(`${ALICORN_RECEIPT_PREFIX}{oops`)).toBeNull()
    expect(parseAlicornReceipt(`${ALICORN_RECEIPT_PREFIX}{"summary":""}`)).toBeNull()
    expect(
      parseAlicornReceipt(`${ALICORN_RECEIPT_PREFIX}{"summary":"x","undo":{"action":"t"}}`)
    ).toBeNull()
  })
})
