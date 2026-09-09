import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const LEDGER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ledger', 'report'],
    summary: 'Print interruptions per completed task from the Alicorn ledger',
    usage:
      'alicorn ledger report [--stage <key>] [--project <id>] [--member <id>] [--run <id>] [--strategy <single|orchestrated>] [--since <iso>] [--until <iso>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'stage',
      'project',
      'member',
      'run',
      'strategy',
      'since',
      'until'
    ],
    examples: [
      'alicorn ledger report --project proj_1 --json',
      'alicorn ledger report --run run_42 --json',
      'alicorn ledger report --strategy orchestrated --since 2026-09-01T00:00:00.000Z'
    ]
  },
  {
    path: ['ledger', 'outbox'],
    summary: 'Show pending or dead ledger outbox rows',
    usage: 'alicorn ledger outbox [--dead] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dead', 'limit'],
    examples: ['alicorn ledger outbox --dead --json']
  },
  {
    path: ['ledger', 'outbox-requeue'],
    summary: 'Requeue a dead ledger outbox row, or all dead rows',
    usage: 'alicorn ledger outbox-requeue (--id <id> | --all [--kind <kind>]) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'all', 'kind'],
    examples: [
      'alicorn ledger outbox-requeue --id lob_abc123',
      'alicorn ledger outbox-requeue --all'
    ]
  }
]
