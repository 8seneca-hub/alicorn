import type { alicornFetch as AlicornFetch } from './control-plane-http'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import type { Task, TaskInput, TaskPatch } from '../../shared/alicorn/tasks'

/**
 * The board's slice of the control-plane client. Split from `control-plane-client` only for
 * length; it shares that module's `request`/`readJson`, so auth, timeouts and error shape are
 * still decided in exactly one place.
 */
export type TaskClient = {
  listTasks: (projectId: string) => Promise<Task[]>
  createTask: (input: TaskInput) => Promise<Task>
  updateTask: (id: string, patch: TaskPatch) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
}

function taskPath(taskId: string): string {
  return `/v1/tasks/${encodeURIComponent(taskId)}`
}

function projectTasksPath(projectId: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}/tasks`
}

export function createTaskClient(deps: {
  readJson: <T>(service: 'control' | 'ledger', path: string, init?: RequestInit) => Promise<T>
  request: typeof AlicornFetch
}): TaskClient {
  const { readJson, request } = deps
  return {
    listTasks: async (projectId) => {
      const body = await readJson<{ tasks: Task[] }>('control', projectTasksPath(projectId))
      return body.tasks ?? []
    },

    createTask: async (input) => {
      const body = await readJson<{ task: Task }>('control', '/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(input)
      })
      return body.task
    },

    updateTask: async (id, patch) => {
      const body = await readJson<{ task: Task }>('control', taskPath(id), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
      return body.task
    },

    // 204 No Content, like deleteMember — the body is cancelled rather than left unread.
    deleteTask: async (id) => {
      await cancelUnreadResponseBody(await request('control', taskPath(id), { method: 'DELETE' }))
    }
  }
}
