import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Why `board-automation` and not `automation`: `automations` already names scheduled automations,
// and two command groups one letter apart is a trap when the point of this one is stopping runaway
// agents in a hurry.
export const BOARD_AUTOMATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['board-automation', 'status'],
    summary: 'Show whether board automation is running for a repo',
    usage: 'alicorn board-automation status --repo <repo_id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    examples: ['alicorn board-automation status --repo my-repo']
  },
  {
    path: ['board-automation', 'stop'],
    summary: 'Stop board automation globally, or for one repo',
    usage: 'alicorn board-automation stop [--repo <repo_id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    notes: [
      'Without --repo this stops every board, which is the switch to reach for before you know which board is misbehaving.',
      'Stopping does not interrupt a dispatch already running; it prevents the next one.'
    ],
    examples: ['alicorn board-automation stop', 'alicorn board-automation stop --repo my-repo']
  },
  {
    path: ['board-automation', 'resume'],
    summary: 'Resume board automation globally, or for one repo',
    usage: 'alicorn board-automation resume [--repo <repo_id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    notes: [
      'A global stop keeps every board off until it is resumed, even a board resumed on its own.'
    ],
    examples: ['alicorn board-automation resume', 'alicorn board-automation resume --repo my-repo']
  }
]
