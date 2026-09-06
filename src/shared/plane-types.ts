// Plane exposes one REST API (v1) for both Plane Cloud and self-hosted
// deployments, authenticated by a workspace-scoped API key. A connection is
// therefore (deployment, workspace) — the pair the key is valid for.

export type PlaneConnection = {
  id: string
  /** Origin of the deployment: https://plane.example.com, or https://api.plane.so for Plane Cloud. */
  baseUrl: string
  workspaceSlug: string
  displayName: string
}

export type PlaneViewer = {
  id: string
  displayName: string
  email: string | null
  avatarUrl?: string
}

export type PlaneConnectionSelection = (string & {}) | 'all'

export type PlaneConnectionStatus = {
  connected: boolean
  viewer: PlaneViewer | null
  connections?: PlaneConnection[]
  activeConnectionId?: string | null
  selectedConnectionId?: PlaneConnectionSelection | null
  // Set when a stored key exists but could not be decrypted, so the UI can
  // explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type PlaneProject = {
  id: string
  /** Short key shown in issue identifiers, e.g. ALC in ALC-11. */
  identifier: string
  name: string
  description?: string
  connectionId?: string
  workspaceSlug?: string
}

// Plane separates a state's display name from its group. Automation and
// reporting key off the group; the name is user-editable per project.
export type PlaneStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export type PlaneState = {
  id: string
  name: string
  color: string
  group: PlaneStateGroup
  isDefault: boolean
}

export type PlanePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export type PlaneMember = {
  id: string
  displayName: string
  email: string | null
  avatarUrl?: string
}

export type PlaneIssue = {
  id: string
  /** Per-project running number; `${project.identifier}-${sequenceId}` is the readable id. */
  sequenceId: number
  readableId: string
  name: string
  descriptionHtml: string
  priority: PlanePriority
  stateId: string | null
  projectId: string
  assigneeIds: string[]
  labelIds: string[]
  parentId: string | null
  startDate: string | null
  targetDate: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  isDraft: boolean
  connectionId?: string
  webUrl?: string
}

export const PLANE_STATE_GROUPS: readonly PlaneStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled'
]

export const PLANE_PRIORITIES: readonly PlanePriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none'
]

// Reads answer with this envelope rather than rejecting: a bad key or a dropped
// connection has to reach the caller as something it can show, across both the
// IPC and the runtime-RPC boundary.
export type PlaneResult<T> = { ok: true; value: T } | { ok: false; error: string }
