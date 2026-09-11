import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const MCP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mcp', 'serve'],
    // Hidden: an agent's MCP client launches this, and a human running it gets a process that
    // reads JSON-RPC from a terminal and appears to hang.
    hidden: true,
    summary: 'Serve Alicorn’s control plane to an agent over MCP (stdio)',
    usage: 'alicorn mcp serve',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Speaks JSON-RPC 2.0 on stdin/stdout. Every mutation answers with a receipt naming the change and its undo.',
      'Required checks, autonomy levels and stage reversibility are deliberately not exposed: a member may not author the criteria that judge it.'
    ]
  }
]
