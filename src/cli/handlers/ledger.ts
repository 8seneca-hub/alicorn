import type { CommandHandler } from '../dispatch'
import { LEDGER_REPORT_HANDLERS } from './ledger/report-handlers'
import { LEDGER_OUTBOX_HANDLERS } from './ledger/outbox-handlers'

export const LEDGER_HANDLERS: Record<string, CommandHandler> = {
  ...LEDGER_REPORT_HANDLERS,
  ...LEDGER_OUTBOX_HANDLERS
}
