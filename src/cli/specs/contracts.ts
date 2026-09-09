import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const CONTRACT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['contracts', 'mock'],
    summary: 'Print a deterministic example value for a registered contract',
    usage: 'orca contracts mock <name> [--out <file>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'out'],
    positionalArgs: ['name'],
    examples: [
      'orca contracts mock RefundRequest',
      'orca contracts mock "GET /refunds/{id}" --out fixtures/refund.json'
    ]
  }
]
