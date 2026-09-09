import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Gate policy surface (GP1): creating a gate evaluates it, so a caller cannot ask and ignore.
export const ORCHESTRATION_GATE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['orchestration', 'gate-create'],
    summary: 'Create a decision gate blocking a task',
    usage:
      'orca orchestration gate-create --task <task_id> --question <text> [--options <json_array>] [--evaluate] [--stage-key <key>] [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'task',
      'question',
      'options',
      'evaluate',
      'stage-key',
      'from',
      'retry-request'
    ],
    notes: [
      '--evaluate runs the autonomy policy and records the decision it would have made on the gate. The gate still blocks: nothing auto-resolves.'
    ]
  },
  {
    path: ['orchestration', 'team-propose'],
    summary: 'Compose a team from member roles and gate it for approval',
    usage:
      'orca orchestration team-propose --task <task_id> [--worktree <selector>] [--goal <text>] [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'worktree', 'goal', 'from', 'retry-request'],
    notes: [
      'The proposal always opens a decision gate: there is no read that answers "who would you pick?" without asking a human about the answer.',
      'A seat is left empty rather than filled with a member that could not be launched into it — a reviewer on the developer backend is refused at launch.',
      '--worktree names the workspace: it is what ranks candidates on their accept rate in that project, and where the roster is written for the lead.'
    ]
  },
  {
    path: ['orchestration', 'verify-record'],
    summary: 'Record a named check result for a task',
    usage:
      'orca orchestration verify-record --task <task_id> --name <text> --status <passed|failed|skipped|error> [--kind <kind>] [--dispatch <dispatch_id>] [--optional] [--detail <json_object>] [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'task',
      'name',
      'status',
      'kind',
      'dispatch',
      'optional',
      'detail',
      'from',
      'retry-request'
    ],
    notes: [
      'A gate opened with --evaluate reads these results; a check the project requires and nobody recorded reads as unverified, never as passed.'
    ]
  },
  {
    path: ['orchestration', 'gate-resolve'],
    summary: 'Resolve a pending decision gate',
    usage:
      'orca orchestration gate-resolve --id <gate_id> --resolution <text> [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'resolution', 'from', 'retry-request']
  },
  {
    path: ['orchestration', 'gate-list'],
    summary: 'List decision gates',
    usage:
      'orca orchestration gate-list [--task <task_id>] [--status <status>] [--run <run_id>] [--from <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'status', 'run', 'from'],
    notes: ['--run inspects a named Run without binding; otherwise gates are scoped to the caller.']
  }
]
