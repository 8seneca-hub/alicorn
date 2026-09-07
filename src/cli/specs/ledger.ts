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
  },
  {
    path: ['ledger', 'outbox'],
    summary: 'Show pending or dead ledger outbox rows',
    usage: 'orca ledger outbox [--dead] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dead', 'limit'],
    examples: ['orca ledger outbox --dead --json']
  },
  {
    path: ['ledger', 'outbox-requeue'],
    summary: 'Requeue a dead ledger outbox row',
    usage: 'orca ledger outbox-requeue --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['orca ledger outbox-requeue --id lob_abc123']
  }
]
