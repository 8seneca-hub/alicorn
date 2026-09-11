import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  asNonEmptyString,
  attemptControlPlane as attempt,
  type AlicornFailure
} from './alicorn-control-plane-result'
import type { Task, TaskInput, TaskPatch } from '../../shared/alicorn/tasks'
import type {
  TaskWorktreeTuple,
  TaskWorktreeTupleInput
} from '../../shared/alicorn/feature-workspace-tuples'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { materialiseAlicornMcpConfig } from '../alicorn/alicorn-mcp-config'

/**
 * The board's reads and writes. Split from `alicorn-handlers` only for length.
 *
 * The Control API's zod schema is the authority on a body's shape; these only reject what could
 * never be one, so a bad field comes back as the API's own 400 rather than a vaguer one invented
 * here.
 */
function asRecord<T>(value: unknown): T | null {
  return value && typeof value === 'object' ? (value as T) : null
}

export function registerAlicornTaskHandlers(deps: {
  client: ControlPlaneClient | null
  getOrchestrationDb: () => OrchestrationDb
}): void {
  // Written on demand so a session Alicorn starts can be pointed at it. Failure answers null and
  // the launch simply carries no MCP — an agent without Alicorn's tools is a smaller loss than a
  // session that refuses to start.
  ipcMain.handle(
    ALICORN_IPC.mcpConfigPath,
    async (): Promise<{ ok: true; path: string } | AlicornFailure> => {
      try {
        return { ok: true, path: await materialiseAlicornMcpConfig(getProfileUserDataPath()) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // The tuples live in the client's own orchestration SQLite, not the control plane: execution is
  // on the client, and a worktree path names nothing on another host. So these two are the only
  // task handlers that never touch the network.
  ipcMain.handle(
    ALICORN_IPC.tasksWorktreesList,
    async (
      _event,
      args: { taskId?: unknown }
    ): Promise<{ ok: true; tuples: TaskWorktreeTuple[] } | AlicornFailure> => {
      const taskId = asNonEmptyString(args?.taskId)
      if (!taskId) {
        return { ok: false, error: 'invalid_body' }
      }
      return { ok: true, tuples: deps.getOrchestrationDb().listTaskWorktrees(taskId) }
    }
  )

  ipcMain.handle(
    ALICORN_IPC.tasksWorktreesBind,
    async (
      _event,
      args: { taskId?: unknown; tuples?: unknown }
    ): Promise<{ ok: true; tuples: TaskWorktreeTuple[] } | AlicornFailure> => {
      const taskId = asNonEmptyString(args?.taskId)
      if (!taskId || !Array.isArray(args?.tuples)) {
        return { ok: false, error: 'invalid_body' }
      }
      return {
        ok: true,
        tuples: deps
          .getOrchestrationDb()
          .setTaskWorktrees(taskId, args.tuples as TaskWorktreeTupleInput[])
      }
    }
  )

  ipcMain.handle(
    ALICORN_IPC.tasksList,
    async (
      _event,
      args: { projectId?: unknown }
    ): Promise<{ ok: true; tasks: Task[] } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        tasks: await client.listTasks(projectId)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.tasksCreate,
    async (_event, input: unknown): Promise<{ ok: true; task: Task } | AlicornFailure> => {
      const taskInput = asRecord<TaskInput>(input)
      if (!taskInput) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        task: await client.createTask(taskInput)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.tasksUpdate,
    async (
      _event,
      args: { id?: unknown; patch?: unknown }
    ): Promise<{ ok: true; task: Task } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      const patch = asRecord<TaskPatch>(args?.patch)
      if (!id || !patch) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        task: await client.updateTask(id, patch)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.tasksDelete,
    async (_event, args: { id?: unknown }): Promise<{ ok: true } | AlicornFailure> => {
      const id = asNonEmptyString(args?.id)
      if (!id) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => {
        await client.deleteTask(id)
        return { ok: true as const }
      })
    }
  )
}
