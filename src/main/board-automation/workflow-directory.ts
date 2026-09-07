import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import type { Workflow } from '../../shared/alicorn/workflows'
import {
  bindColumnToStage,
  selectProjectWorkflow,
  type StageBinding
} from './workflow-stage-binding'

const DEFAULT_TTL_MS = 60_000

type Cached = { value: Workflow | null; fetchedAt: number }

export type WorkflowDirectory = {
  /** The stage a board column binds to, for this project. */
  resolveColumn: (projectId: string, toStatusId: string) => Promise<StageBinding>
}

/**
 * Cached workflow reads for board automation.
 *
 * The staleness trade is the opposite of the member directory's. There, serving a slightly old
 * member list is better than failing a launch. Here the cached value decides whether a stage is
 * irreversible, so a stale read can only be served inside the TTL — past it, an unreadable control
 * plane refuses rather than dispatching on last-known attributes that may since have gained a hard
 * stop.
 */
export function createWorkflowDirectory(
  client: ControlPlaneClient | null,
  opts?: { ttlMs?: number; now?: () => number }
): WorkflowDirectory {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  const now = opts?.now ?? Date.now
  const byProject = new Map<string, Cached>()

  return {
    resolveColumn: async (projectId, toStatusId) => {
      // Why not `unavailable`: no control plane configured at all is the pre-v1.5 shape, not a
      // failed read, and the ad-hoc rules are the legitimate model there.
      if (!client) {
        return { kind: 'none' }
      }
      const cached = byProject.get(projectId)
      if (cached && now() - cached.fetchedAt < ttlMs) {
        return cached.value ? bindColumnToStage(cached.value, toStatusId) : { kind: 'none' }
      }
      try {
        const summaries = await client.listWorkflows(projectId)
        const summary = selectProjectWorkflow(summaries)
        const workflow = summary ? await client.getWorkflow(summary.id) : null
        byProject.set(projectId, { value: workflow, fetchedAt: now() })
        return workflow ? bindColumnToStage(workflow, toStatusId) : { kind: 'none' }
      } catch (error) {
        return {
          kind: 'unavailable',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}
