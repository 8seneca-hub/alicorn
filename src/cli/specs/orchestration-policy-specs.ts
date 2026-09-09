import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Autonomy policy as data (GP2). Read and write the policy a gate applies, and audit the standing
// exceptions to it. Split from orchestration.ts for the same reason the gate commands were: that
// file is at its line cap and these belong together.
export const ORCHESTRATION_POLICY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['orchestration', 'policy-get'],
    summary: 'Show the autonomy policy and stage config that apply to a project stage',
    usage:
      'alicorn orchestration policy-get --project <project_id> [--stage-key <key>] [--member <member_id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'stage-key', 'member'],
    notes: [
      'A project that authored nothing still gets a policy: the shown one is the default, flagged as unauthored.',
      'Stage reversibility and inherited cost are authored, never inferred — an irreversible stage gates whatever the policy says.'
    ]
  },
  {
    path: ['orchestration', 'policy-set'],
    summary: 'Author the autonomy policy for a project stage',
    usage:
      'alicorn orchestration policy-set --project <project_id> --mode <always_gate|evidence|never_gate> [--stage-key <key>] [--member <member_id>] [--min-runs <n>] [--min-accept-rate <0..1>] [--max-files <n>] [--max-spend-cents <n>] [--expires-at <iso8601>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'project',
      'mode',
      'stage-key',
      'member',
      'min-runs',
      'min-accept-rate',
      'max-files',
      'max-spend-cents',
      'expires-at',
      'retry-request'
    ],
    notes: [
      '--mode never_gate requires --expires-at in the future. A standing exception that cannot lapse is rejected.',
      'This replaces the policy for the stage; an omitted budget clears it rather than leaving the old value.',
      'The author is the authenticated caller and is never taken from the request.'
    ]
  },
  {
    path: ['orchestration', 'policy-list'],
    summary: 'List authored autonomy policies and standing never_gate exceptions',
    usage: 'alicorn orchestration policy-list --project <project_id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project'],
    notes: ['Lapsed exceptions are listed too — when an exception ended is part of the audit.']
  },
  {
    path: ['orchestration', 'evidence'],
    summary: "Show a task's track record and what the autonomy policy would decide now",
    usage: 'alicorn orchestration evidence --task <task_id> [--stage-key <key>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'stage-key'],
    notes: [
      'Advisory only. Reading this never resolves a gate; gate-create is the only place a decision is acted on.'
    ]
  }
]
