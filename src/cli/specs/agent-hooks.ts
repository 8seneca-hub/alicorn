import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: 'Repair Alicorn-managed Codex hook trust before a shell launch',
    usage: 'alicorn agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Alicorn-managed agent status hooks are enabled',
    usage: 'alicorn agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['alicorn agent hooks status', 'alicorn agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Alicorn-managed agent status hooks and remove local hook entries',
    usage: 'alicorn agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['alicorn agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Alicorn-managed agent status hooks',
    usage: 'alicorn agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['alicorn agent hooks on']
  }
]
