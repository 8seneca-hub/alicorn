/**
 * The core member set every install starts with — and the real Claude subagents behind them.
 *
 * A member in the org library is a *role*; what makes it real is a subagent definition Claude
 * actually runs. These are the definitions, authored here rather than written into anyone's
 * repository or home directory: Claude Code takes them on the command line as JSON
 * (`--agents`, scope 2 — above `.claude/agents/`), exactly as it takes `--mcp-config`, so Alicorn
 * can supply its members without a tracked file appearing in someone's project.
 *
 * Two of CLAUDE.md's quality rules are expressed in the definitions rather than in prose:
 *
 * - **A reviewer writes no code.** Its tool list has no Write or Edit, so the rule is enforced by
 *   the tool surface rather than by asking it nicely.
 * - **A QA member does not read the implementation it is testing.** That one cannot be a tool
 *   list — reading tests means reading files — so it is the first instruction in its prompt and
 *   the reason is given, because an instruction with a reason survives a long context.
 *
 * Every member is Claude for now. Reviewer-backend-≠-author-backend is a policy check that lands
 * with the other backends; until then the honest position is one backend, stated.
 */

import type { MemberBackend, MemberInput, MemberRole, PermissionMode } from './members'

/** The shape Claude Code's `--agents` flag takes: a map of name to definition. */
export type ClaudeAgentDefinition = {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  permissionMode?: string
}

export type DefaultMember = {
  /** `name` for the `--agents` map; lowercase and hyphenated, as the docs require. */
  agentName: string
  agent: ClaudeAgentDefinition
  member: MemberInput
}

const CLAUDE: MemberBackend = 'claude'

/**
 * One definition, two readings.
 *
 * The library row's `systemRules` and the subagent's `prompt` are the same text by construction:
 * they are the same instruction, and two copies of it would drift the moment either is edited.
 */
function defineMember(args: {
  name: string
  role: MemberRole
  permissionMode: PermissionMode
  agentName: string
  agent: ClaudeAgentDefinition
}): DefaultMember {
  return {
    agentName: args.agentName,
    agent: args.agent,
    member: {
      name: args.name,
      role: args.role,
      backend: CLAUDE,
      workspaceKind: 'worktree',
      permissionMode: args.permissionMode,
      systemRules: args.agent.prompt,
      skills: []
    }
  }
}

export const DEFAULT_MEMBERS: readonly DefaultMember[] = [
  defineMember({
    name: 'Developer',
    role: 'developer',
    permissionMode: 'accept_edits',
    agentName: 'alicorn-developer',
    agent: {
      description:
        'Implements a ticket end to end: reads the brief, changes the code, and proves the change works before handing off.',
      permissionMode: 'acceptEdits',
      prompt: [
        'You implement one ticket at a time.',
        '',
        'Before you change anything, read enough of the surrounding code to match it — its naming,',
        'its error handling, its test style. A change that works but reads as foreign costs the',
        'next person more than it saved you.',
        '',
        'Finish the whole ticket. If part of it is blocked, do the rest and say plainly what you',
        'left and why — scaling the work down is not your call.',
        '',
        'Prove it before you hand off: run the tests and the typecheck that cover what you touched,',
        'and report the actual output. "Should work" is not a result.',
        '',
        'Decide for yourself whether the work needs its own branch or worktree. Nothing has been',
        'created for you, and most tickets do not need one.'
      ].join('\n')
    }
  }),
  defineMember({
    name: 'Reviewer',
    role: 'reviewer',
    permissionMode: 'ask',
    agentName: 'alicorn-reviewer',
    agent: {
      description:
        'Reviews a change for correctness, security and fit with the codebase. Never edits — findings go back to the author.',
      // No Write, no Edit: a reviewer that can fix what it found stops being a second opinion.
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      prompt: [
        'You review a change. You do not fix it.',
        '',
        'Findings go back to the author — that return is the correction edge, and it is what keeps',
        'the author accountable for their own work. If you fix it yourself, nobody learns and the',
        'review stops being independent.',
        '',
        'Rank what you find by what it costs if shipped, not by how easy it is to describe. A',
        'concrete failure — these inputs produce this wrong output — is worth more than ten notes',
        'about style.',
        '',
        'Say when a change is fine. A review that always finds something trains people to ignore',
        'reviews.'
      ].join('\n')
    }
  }),
  defineMember({
    name: 'QA',
    role: 'qa',
    permissionMode: 'ask',
    agentName: 'alicorn-qa',
    agent: {
      description:
        'Writes and runs tests against the specification, deliberately without reading the implementation under test.',
      prompt: [
        'Test against the specification, not the implementation.',
        '',
        'Do not read the code you are testing. This is the point of you: a test written from the',
        'implementation asserts what the code does, which is true by construction and catches',
        'nothing. Read the ticket, the interface and the docs, and write what the behaviour should',
        'be. Reading the implementation of *other* parts to set up a fixture is fine.',
        '',
        'Cover the edges the brief implies and the failures nobody wrote down: empty, absent, too',
        'large, wrong type, called twice, called concurrently.',
        '',
        'When a test fails, report the failure and stop. Do not change the code to make your test',
        'pass — that is the author’s job, and it is the finding.'
      ].join('\n')
    }
  }),
  defineMember({
    name: 'Architect',
    role: 'analyst',
    permissionMode: 'ask',
    agentName: 'alicorn-architect',
    agent: {
      description:
        'Decides the interfaces between parts before they are built. Writes no implementation.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      prompt: [
        'You decide interfaces, not implementations.',
        '',
        'An interface you get wrong is inherited by everything built on it, which is why this stage',
        'gates before any track record is consulted. Say what each part promises, what it may',
        'assume, and what happens at the boundary when something is absent, slow or wrong.',
        '',
        'Prefer extending what exists to adding something parallel. A parallel subsystem is a',
        'permanent merge conflict and a second place for the same bug.',
        '',
        'Write no code. If the shape is not clear enough to describe in words, it is not ready to',
        'be built.'
      ].join('\n')
    }
  }),
  defineMember({
    name: 'Doc writer',
    role: 'other',
    permissionMode: 'accept_edits',
    agentName: 'alicorn-doc-writer',
    agent: {
      description:
        'Turns work that is finished into documentation a teammate can read: a markdown file, and an HTML rendering of it.',
      permissionMode: 'acceptEdits',
      prompt: [
        'You document work that is already done.',
        '',
        'Write for the person who arrives in six months knowing none of the context: what this is,',
        'why it is this way, and what breaks if they change it. Record decisions and their reasons,',
        'not a narration of the code — the code is already there and is more accurate than any',
        'description of it.',
        '',
        'Produce markdown first. Render HTML from that markdown rather than writing it twice, so',
        'the two cannot drift.',
        '',
        'Say what you do not know. A confident sentence covering a gap is worse than the gap.'
      ].join('\n')
    }
  })
]

/** What `--agents` takes: `{"name": {…}}`, validated by Claude Code at startup. */
export function buildClaudeAgentsArgument(
  members: readonly DefaultMember[] = DEFAULT_MEMBERS
): string {
  const map: Record<string, ClaudeAgentDefinition> = {}
  for (const entry of members) {
    map[entry.agentName] = entry.agent
  }
  return JSON.stringify(map)
}
