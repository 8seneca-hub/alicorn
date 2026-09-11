/**
 * The control plane, reachable from outside the renderer.
 *
 * The renderer already reaches Members, Projects and Tasks over `alicorn:*` IPC. These are the
 * same reads and writes on the runtime RPC seam, which is what the CLI — and therefore the Alicorn
 * MCP server an agent talks to — can call. Nothing here holds credentials: `alicornFetch` resolves
 * the bearer from the app's own environment, so a worker terminal never sees a token.
 *
 * PRODUCT-ARCHITECTURE §5 draws the line these methods sit on. An agent may create a task or a
 * member and assign one — each returns a receipt. It may not author a required check, an autonomy
 * level, or a stage's reversibility, so none of those are here at all: the boundary is enforced by
 * absence rather than by a flag a caller could set.
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString } from '../schemas'
import { alicornFetch } from '../../../alicorn/control-plane-http'
import type { Member } from '../../../../shared/alicorn/members'
import type { Project, ProjectInput } from '../../../../shared/alicorn/projects'
import type { Task } from '../../../../shared/alicorn/tasks'

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await alicornFetch('control', path, init)
  return (await response.json()) as T
}

const TaskSourceParams = z.object({
  provider: z.enum(['github', 'gitlab', 'linear', 'jira', 'plane']),
  ref: z.string().min(1),
  url: OptionalString
})

const ProjectCreateParams = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  repoIds: z.array(z.string().min(1))
})

const TaskCreateParams = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  source: TaskSourceParams.optional(),
  context: OptionalString,
  column: OptionalString,
  executionStrategy: z.enum(['single', 'orchestrated']).optional(),
  stageKey: OptionalString,
  memberIds: z.array(z.string().min(1)).optional()
})

const TaskUpdateParams = z.object({
  taskId: z.string().min(1),
  title: OptionalString,
  context: OptionalString,
  column: OptionalString,
  executionStrategy: z.enum(['single', 'orchestrated']).optional(),
  stageKey: OptionalString,
  memberIds: z.array(z.string().min(1)).optional()
})

const MemberCreateParams = z.object({
  name: z.string().min(1),
  role: z.enum(['developer', 'reviewer', 'qa', 'analyst', 'other']),
  backend: z.enum(['claude', 'codex', 'grok', 'openclaude']),
  workspaceKind: z.enum(['worktree', 'folder']).optional(),
  permissionMode: z.enum(['ask', 'accept_edits', 'yolo']).optional(),
  systemRules: OptionalString
})

export const ALICORN_CONTROL_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'alicorn.projectList',
    params: z.object({}),
    handler: async () => {
      const body = await readJson<{ projects: Project[] }>('/v1/projects')
      return { projects: body.projects ?? [] }
    }
  }),
  defineMethod({
    name: 'alicorn.projectCreate',
    params: ProjectCreateParams,
    handler: async (params) => {
      const body = await readJson<{ project: Project }>('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          key: params.key,
          repoIds: params.repoIds
        } satisfies ProjectInput)
      })
      return { project: body.project }
    }
  }),
  defineMethod({
    name: 'alicorn.memberList',
    params: z.object({}),
    handler: async () => {
      const body = await readJson<{ members: Member[] }>('/v1/members')
      return { members: body.members ?? [] }
    }
  }),
  defineMethod({
    name: 'alicorn.memberCreate',
    params: MemberCreateParams,
    handler: async (params) => {
      const body = await readJson<{ member: Member }>('/v1/members', {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          role: params.role,
          backend: params.backend,
          workspaceKind: params.workspaceKind ?? 'worktree',
          permissionMode: params.permissionMode ?? 'ask',
          systemRules: params.systemRules ?? '',
          skills: []
        })
      })
      return { member: body.member }
    }
  }),
  defineMethod({
    name: 'alicorn.taskList',
    params: z.object({ projectId: z.string().min(1) }),
    handler: async (params) => {
      const body = await readJson<{ tasks: Task[] }>(
        `/v1/projects/${encodeURIComponent(params.projectId)}/tasks`
      )
      return { tasks: body.tasks ?? [] }
    }
  }),
  defineMethod({
    name: 'alicorn.taskCreate',
    params: TaskCreateParams,
    handler: async (params) => {
      const body = await readJson<{ task: Task }>('/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId: params.projectId,
          title: params.title,
          context: params.context ?? '',
          column: params.column ?? 'todo',
          executionStrategy: params.executionStrategy ?? 'single',
          stageKey: params.stageKey ?? null,
          memberIds: params.memberIds ?? [],
          source: params.source ? { ...params.source, url: params.source.url ?? null } : null
        })
      })
      return { task: body.task }
    }
  }),
  defineMethod({
    name: 'alicorn.taskUpdate',
    params: TaskUpdateParams,
    handler: async (params) => {
      // Only the fields the caller named: a patch that echoed defaults would silently reset a
      // column or an assignment the caller never mentioned.
      const patch: Record<string, unknown> = {}
      if (params.title !== undefined) {
        patch.title = params.title
      }
      if (params.context !== undefined) {
        patch.context = params.context
      }
      if (params.column !== undefined) {
        patch.column = params.column
      }
      if (params.executionStrategy !== undefined) {
        patch.executionStrategy = params.executionStrategy
      }
      if (params.stageKey !== undefined) {
        patch.stageKey = params.stageKey
      }
      if (params.memberIds !== undefined) {
        patch.memberIds = params.memberIds
      }
      const body = await readJson<{ task: Task }>(
        `/v1/tasks/${encodeURIComponent(params.taskId)}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      )
      return { task: body.task }
    }
  })
]
