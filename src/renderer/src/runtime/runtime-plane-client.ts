import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState
} from '../../../shared/plane-types'
import { callRuntimeRpc } from './runtime-rpc-client'
import { getProviderRuntimeTarget, type RuntimeProviderSettings } from './runtime-provider-target'

export type RuntimePlaneSettings = RuntimeProviderSettings

// Status is cheap and blocks UI; data reads may page through a whole project.
const STATUS_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 30_000
// Why: shorter than a read — a board drag waits on this write, so it must fail fast enough that the
// column does not appear stuck rather than rejected.
const WRITE_TIMEOUT_MS = 15_000

// Every call routes to the host that owns the workspace. On a remote host the
// API key never leaves that machine — only the connect payload crosses the wire.
export async function planeStatus(settings: RuntimePlaneSettings): Promise<PlaneConnectionStatus> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectionStatus>(target, 'plane.status', undefined, {
        timeoutMs: STATUS_TIMEOUT_MS
      })
    : window.api.plane.status()
}

export async function planeConnect(
  settings: RuntimePlaneSettings,
  args: { baseUrl: string; workspaceSlug: string; apiKey: string }
): Promise<PlaneResult<PlaneConnectionStatus>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneConnectionStatus>>(target, 'plane.connect', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.connect(args)
}

export async function planeDisconnect(
  settings: RuntimePlaneSettings,
  args?: { connectionId?: string }
): Promise<PlaneConnectionStatus> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectionStatus>(target, 'plane.disconnect', args, {
        timeoutMs: STATUS_TIMEOUT_MS
      })
    : window.api.plane.disconnect(args)
}

export async function planeListProjects(
  settings: RuntimePlaneSettings,
  args?: { connectionId?: string }
): Promise<PlaneResult<PlaneProject[]>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneProject[]>>(target, 'plane.listProjects', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.listProjects(args)
}

export async function planeListStates(
  settings: RuntimePlaneSettings,
  args: { projectId: string; connectionId?: string }
): Promise<PlaneResult<PlaneState[]>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneState[]>>(target, 'plane.listStates', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.listStates(args)
}

export async function planeListMembers(
  settings: RuntimePlaneSettings,
  args?: { connectionId?: string }
): Promise<PlaneResult<PlaneMember[]>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneMember[]>>(target, 'plane.listMembers', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.listMembers(args)
}

export async function planeListIssues(
  settings: RuntimePlaneSettings,
  args: {
    projectId: string
    projectIdentifier?: string
    orderBy?: string
    connectionId?: string
  }
): Promise<PlaneResult<PlaneIssue[]>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneIssue[]>>(target, 'plane.listIssues', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.listIssues(args)
}

export async function planeGetIssue(
  settings: RuntimePlaneSettings,
  args: {
    projectId: string
    issueId: string
    projectIdentifier?: string
    connectionId?: string
  }
): Promise<PlaneResult<PlaneIssue | null>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneIssue | null>>(target, 'plane.getIssue', args, {
        timeoutMs: READ_TIMEOUT_MS
      })
    : window.api.plane.getIssue(args)
}

// Why: the write uses its own timeout rather than READ_TIMEOUT_MS — a board drag waits on it, and a
// slow write must fail fast enough that the board does not appear stuck.
export async function planeUpdateIssueState(
  settings: RuntimePlaneSettings,
  args: {
    projectId: string
    issueId: string
    stateId: string
    projectIdentifier?: string
    connectionId?: string
  }
): Promise<PlaneResult<PlaneIssue | null>> {
  const target = getProviderRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneResult<PlaneIssue | null>>(target, 'plane.updateIssueState', args, {
        timeoutMs: WRITE_TIMEOUT_MS
      })
    : window.api.plane.updateIssueState(args)
}
