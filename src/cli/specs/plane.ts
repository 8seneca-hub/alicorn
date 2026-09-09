import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Issues are named the way they read on the board — ALC-11. A bare uuid works
// too, but only with --project: Plane looks issues up inside a project and has
// no workspace-wide route to fall back on.
export const PLANE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'issue'],
    summary: 'Read a Plane issue and its comments',
    usage: 'alicorn plane issue <id|PROJ-123> [--project <id>] [--connection <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'connection', 'id'],
    positionalArgs: ['id'],
    notes: [
      'A readable id resolves on its own; an issue uuid needs --project.',
      'Comment bodies are rendered as text — Plane stores them as HTML.'
    ],
    examples: ['alicorn plane issue ALC-11', 'alicorn plane issue ALC-11 --json']
  },
  {
    path: ['plane', 'search'],
    summary: 'Search issues in a Plane project',
    usage:
      'alicorn plane search --project <id> [--state <group>] [--query <text>] [--limit <n>] [--connection <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'state', 'query', 'limit', 'connection'],
    notes: [
      '--state filters on the state group (backlog, unstarted, started, completed, cancelled), not the project-specific state name.',
      'Plane has no cross-project issue list, so --project is required.'
    ],
    examples: [
      'alicorn plane search --project 2a53f690-4738-4491-b803-bbdf0a6e0cda --state started',
      'alicorn plane search --project <id> --query "auth" --limit 10 --json'
    ]
  },
  {
    path: ['plane', 'comment'],
    summary: 'Comment on a Plane issue',
    usage:
      'alicorn plane comment <id|PROJ-123> --body <text> [--project <id>] [--connection <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'body', 'project', 'connection', 'id'],
    positionalArgs: ['id'],
    notes: ['Blank lines start a new paragraph; the text is escaped, not interpreted as HTML.'],
    examples: ['alicorn plane comment ALC-11 --body "Rebased onto main, CI is green."']
  },
  {
    path: ['plane', 'state'],
    summary: 'Move a Plane issue to a state',
    usage:
      'alicorn plane state <id|PROJ-123> --to <state-name> [--project <id>] [--connection <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'project', 'connection', 'id'],
    positionalArgs: ['id'],
    notes: [
      'A unique prefix names a state; anything matching zero or several states is refused with the candidates listed, rather than guessed.'
    ],
    examples: [
      'alicorn plane state ALC-11 --to "In Review"',
      'alicorn plane state ALC-11 --to Done'
    ]
  }
]
