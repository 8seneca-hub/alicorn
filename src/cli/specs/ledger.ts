import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const LEDGER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ledger', 'report'],
    summary: 'Print interruptions per completed task from the Alicorn ledger',
    usage:
      'orca ledger report [--stage <key>] [--project <id>] [--member <id>] [--since <iso>] [--until <iso>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'stage', 'project', 'member', 'since', 'until'],
    examples: [
      'orca ledger report --project proj_1 --json',
      'orca ledger report --stage build --since 2026-09-01T00:00:00.000Z'
    ]
  }
]
