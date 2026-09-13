/**
 * What an agent may do to Alicorn, and what it gets told afterwards.
 *
 * The tool set is PRODUCT-ARCHITECTURE §5's left-hand column and nothing else: create a task,
 * move one, assign a member, add a member. Required checks, autonomy levels and a stage's
 * reversibility are absent — an agent that could author the criteria it is judged against is the
 * one failure this product cannot have, and absence enforces that better than a permission flag.
 *
 * Every mutation returns a **receipt**: what changed, and how to undo it. §3 makes that the price
 * of conversational configuration — without it the record is not an asset, and the record is the
 * whole claim.
 */

import { DEFAULT_WORKSPACE_STATUSES } from '../../shared/workspace-status-defaults'
import type { AlicornReceipt } from '../../shared/alicorn/receipt'

export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** The runtime RPC method this tool is a thin wrapper over. */
  method: string
  /** Null for a read. A writer returns the sentence and the call that reverses it. */
  receipt:
    | ((result: Record<string, unknown>, args: Record<string, unknown>) => AlicornReceipt)
    | null
}

/**
 * The board's columns, named for the agent.
 *
 * Sourced from the same defaults the board renders so the two cannot drift, and spelled out
 * because the trap here is real: the column *labelled* "Done" has the id `completed`, and an agent
 * that guesses `done` writes a column no board has. The contract keeps the field an opaque string
 * on purpose — a project may rename its columns — so this list is the tool's answer, not a schema
 * constraint, and it is the only place an agent can learn the vocabulary.
 */
const BOARD_COLUMN_IDS = DEFAULT_WORKSPACE_STATUSES.map((status) => status.id)

const COLUMN_FIELD = {
  type: 'string',
  enum: BOARD_COLUMN_IDS,
  description: `Board column id, not its label. ${DEFAULT_WORKSPACE_STATUSES.map(
    (status) => `"${status.label}" is ${status.id}`
  ).join(', ')}.`
} as const

type TaskLike = { id: string; number: number; title: string; column: string; projectId: string }
type MemberLike = { id: string; name: string; role: string; backend: string }

function asTask(result: Record<string, unknown>): TaskLike | null {
  const task = result.task as TaskLike | undefined
  return task && typeof task.id === 'string' ? task : null
}

export const ALICORN_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'alicorn_list_projects',
    description:
      'List the projects in this Alicorn org. A project owns repositories, a board and a workflow.',
    inputSchema: { type: 'object', properties: {} },
    method: 'alicorn.projectList',
    receipt: null
  },
  {
    name: 'alicorn_create_project',
    description:
      'Create a project. A project needs at least one repository. Importing a board from a PM tool creates the project and its context — not its issues, which stay in the tracker and are pulled in one at a time as tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        key: {
          type: 'string',
          description: 'Two to ten uppercase letters or digits — prefixes every task id (PAY-142).'
        },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Alicorn repo ids, from alicorn_list_projects’ existing projects or the desktop.'
        }
      },
      required: ['name', 'key', 'repoIds']
    },
    method: 'alicorn.projectCreate',
    receipt: (result) => {
      const project = result.project as { id: string; name: string; key: string } | undefined
      return project
        ? {
            summary: `Created project ${project.name} (${project.key})`,
            undo: { action: 'project.delete', args: { projectId: project.id } }
          }
        : { summary: 'No project was created', undo: null }
    }
  },
  {
    name: 'alicorn_set_project_context',
    description:
      'Write what a project is for: the domain, the users, the constraints that hold across every ticket. Markdown. It is carried into the brief of every task in the project, so a member reads it before it reads the ticket. Replaces whatever is there — read it first with alicorn_list_projects if you mean to add to it.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        context: {
          type: 'string',
          description: 'Markdown. The part of the job a repository cannot teach.'
        }
      },
      required: ['projectId', 'context']
    },
    method: 'alicorn.projectUpdate',
    receipt: (result) => {
      const project = result.project as { id: string; name: string } | undefined
      return project
        ? {
            summary: `Rewrote the context of ${project.name}`,
            // No undo: the previous text is not returned, and an undo that silently blanks the
            // field would be worse than none. Say so rather than offer a lie.
            undo: null
          }
        : { summary: 'No project was updated', undo: null }
    }
  },
  {
    name: 'alicorn_list_members',
    description:
      'List the org library’s members. A member is a role bound to a backend, a permission mode and a workspace kind.',
    inputSchema: { type: 'object', properties: {} },
    method: 'alicorn.memberList',
    receipt: null
  },
  {
    name: 'alicorn_create_member',
    description:
      'Add a member to the org library. Every project can then use it; a project only ever stores an override.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name, unique in the org.' },
        role: {
          type: 'string',
          enum: ['developer', 'reviewer', 'qa', 'analyst', 'other']
        },
        backend: { type: 'string', enum: ['claude', 'codex', 'grok', 'openclaude'] },
        workspaceKind: { type: 'string', enum: ['worktree', 'folder'] },
        permissionMode: { type: 'string', enum: ['ask', 'accept_edits', 'yolo'] },
        systemRules: { type: 'string', description: 'Standing rules prepended to its briefs.' }
      },
      required: ['name', 'role', 'backend']
    },
    method: 'alicorn.memberCreate',
    receipt: (result) => {
      const member = result.member as MemberLike | undefined
      return member
        ? {
            summary: `Added member ${member.name} — ${member.role} on ${member.backend}`,
            undo: { action: 'member.delete', args: { memberId: member.id } }
          }
        : { summary: 'No member was created', undo: null }
    }
  },
  {
    name: 'alicorn_list_tasks',
    description: 'List a project’s tasks. A task is the unit of work, not a worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project id, or the id of a repository bound to one.'
        }
      },
      required: ['projectId']
    },
    method: 'alicorn.taskList',
    receipt: null
  },
  {
    name: 'alicorn_create_task',
    description:
      'Create a task on a project’s board. This writes a ticket only — it opens no workspace, branch or agent session.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'What needs doing.' },
        context: {
          type: 'string',
          description: 'What the agent cannot read off the repo: the constraint, the edge case.'
        },
        column: { ...COLUMN_FIELD, description: `${COLUMN_FIELD.description} Defaults to todo.` },
        executionStrategy: {
          type: 'string',
          enum: ['single', 'orchestrated'],
          description:
            'single is the default and nearly always right; orchestrated costs roughly 10-15x the tokens.'
        },
        memberIds: { type: 'array', items: { type: 'string' } },
        source: {
          type: 'object',
          description:
            'Where this came from, when importing from a PM tool. Re-importing the same ref answers with the existing task instead of duplicating it.',
          properties: {
            provider: {
              type: 'string',
              enum: ['github', 'gitlab', 'linear', 'jira', 'plane']
            },
            ref: { type: 'string', description: 'The human id, e.g. ALC-11.' },
            url: { type: 'string' }
          },
          required: ['provider', 'ref']
        }
      },
      required: ['projectId', 'title']
    },
    method: 'alicorn.taskCreate',
    receipt: (result, args) => {
      const task = asTask(result)
      if (!task) {
        return { summary: 'No task was created', undo: null }
      }
      const from = args.source ? ` from ${(args.source as { ref?: string }).ref}` : ''
      return {
        summary: `Created task #${task.number} “${task.title}”${from} in ${task.column}`,
        undo: { action: 'task.delete', args: { taskId: task.id } }
      }
    }
  },
  {
    name: 'alicorn_update_task',
    description:
      'Change a task: move it to another column, retitle it, reassign it, or switch its execution strategy. Only the fields you name change.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        context: { type: 'string' },
        column: COLUMN_FIELD,
        executionStrategy: { type: 'string', enum: ['single', 'orchestrated'] },
        memberIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['taskId']
    },
    method: 'alicorn.taskUpdate',
    receipt: (result, args) => {
      const task = asTask(result)
      if (!task) {
        return { summary: 'No task was changed', undo: null }
      }
      const changed = Object.keys(args).filter((key) => key !== 'taskId')
      // The prior values of exactly the fields this call named — the RPC reads the task before it
      // patches it. Without them there is nothing to put back, so the change stands.
      const previous = (result.previous ?? null) as Record<string, unknown> | null
      return {
        summary: `Updated task #${task.number} — ${changed.join(', ') || 'nothing'}`,
        undo:
          previous && Object.keys(previous).length > 0
            ? { action: 'task.update', args: { taskId: task.id, ...previous } }
            : null
      }
    }
  }
]

export function findAlicornMcpTool(name: string): McpToolDefinition | undefined {
  return ALICORN_MCP_TOOLS.find((tool) => tool.name === name)
}
