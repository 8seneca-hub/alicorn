import type { CommandHandler } from '../dispatch'
import { LEDGER_REPORT_HANDLERS } from './ledger/report-handlers'

export const LEDGER_HANDLERS: Record<string, CommandHandler> = {
  ...LEDGER_REPORT_HANDLERS
}
