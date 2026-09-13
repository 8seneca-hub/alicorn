import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inspectMcpConfigContent, type McpServerSummary } from '../../shared/mcp-config'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  asNonEmptyString,
  attemptControlPlane as attempt,
  type AlicornFailure
} from './alicorn-control-plane-result'
import type { Task, TaskInput, TaskPatch } from '../../shared/alicorn/tasks'
import type { AutonomyPolicy, AutonomyPolicyInput } from '../../shared/alicorn/gate-policy'
import type {
  TaskWorktreeTuple,
  TaskWorktreeTupleInput
} from '../../shared/alicorn/feature-workspace-tuples'
import { isTaskSessionBinding, type TaskSessionBinding } from '../../shared/alicorn/task-session'
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
  // Written once at startup as well as on demand: a structured session reads this path from the
  // host's launch args and never asks for it, and Claude exits on a `--mcp-config` that is not
  // there. The args builder checks for the file, so a failure here costs tools, not a session.
  void materialiseAlicornMcpConfig(getProfileUserDataPath()).catch((error) => {
    console.warn('[alicorn] could not write the MCP config', error)
  })

  ipcMain.handle(
    ALICORN_IPC.autonomyPoliciesList,
    async (
      _event,
      args: { projectId?: unknown }
    ): Promise<{ ok: true; policies: AutonomyPolicy[] } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        policies: await client.listAutonomyPolicies(projectId)
      }))
    }
  )

  /**
   * Authoring a policy. Admin-authored per project, never by the member it judges — which the
   * Control API enforces by taking the author from the authenticated actor rather than the body,
   * so there is nothing here that could pass one.
   */
  ipcMain.handle(
    ALICORN_IPC.autonomyPolicySet,
    async (
      _event,
      args: { projectId?: unknown; policy?: unknown }
    ): Promise<{ ok: true; policy: AutonomyPolicy } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      const policy = args?.policy
      if (!projectId || !policy || typeof policy !== 'object') {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        policy: await client.putAutonomyPolicy(projectId, policy as AutonomyPolicyInput)
      }))
    }
  )

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

  // Claude Code's user-scope servers, read here rather than in the renderer: `fs:readFile` is
  // sandboxed to workspace directories on purpose, and the home directory is deliberately outside
  // it. Inspected with the same shared parser the workspace configs use, so the limits, the
  // env-masking and the refusal on malformed JSON are identical.
  ipcMain.handle(
    ALICORN_IPC.mcpGlobalServers,
    async (): Promise<{ ok: true; path: string; servers: McpServerSummary[] } | AlicornFailure> => {
      const path = join(homedir(), '.claude.json')
      try {
        const content = await readFile(path, 'utf8')
        const inspection = inspectMcpConfigContent(
          {
            format: 'claude',
            label: 'Global',
            relativePath: '~/.claude.json',
            serversPath: ['mcpServers']
          },
          content
        )
        return { ok: true, path, servers: inspection.servers }
      } catch {
        // No user-scope config is the ordinary case on a fresh machine, not a failure.
        return { ok: true, path, servers: [] }
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
    ALICORN_IPC.sessionGet,
    async (
      _event,
      args: { subjectId?: unknown }
    ): Promise<{ ok: true; session: TaskSessionBinding | null } | AlicornFailure> => {
      const subjectId = asNonEmptyString(args?.subjectId)
      if (!subjectId) {
        return { ok: false, error: 'invalid_body' }
      }
      return { ok: true, session: deps.getOrchestrationDb().getSubjectSession(subjectId) }
    }
  )

  ipcMain.handle(
    ALICORN_IPC.sessionBind,
    async (
      _event,
      args: { subjectId?: unknown; session?: unknown }
    ): Promise<{ ok: true; session: TaskSessionBinding } | AlicornFailure> => {
      const subjectId = asNonEmptyString(args?.subjectId)
      if (!subjectId || !isTaskSessionBinding(args?.session)) {
        return { ok: false, error: 'invalid_body' }
      }
      return {
        ok: true,
        session: deps.getOrchestrationDb().setSubjectSession(subjectId, args.session)
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
