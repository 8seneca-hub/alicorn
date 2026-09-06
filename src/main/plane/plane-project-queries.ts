import {
  PLANE_STATE_GROUPS,
  type PlaneMember,
  type PlaneProject,
  type PlaneState,
  type PlaneStateGroup
} from '../../shared/plane-types'
import { asRecord, asString, fetchAllPages, type PlaneRecord } from './plane-record-pages'
import { projectPath, workspacePath, type PlaneClient } from './plane-request'

const STATE_GROUP_SET = new Set<string>(PLANE_STATE_GROUPS)

function toStateGroup(value: unknown): PlaneStateGroup {
  // An unknown group is treated as backlog rather than dropped: a state the
  // desktop cannot classify must still be selectable, or issues in it vanish.
  return STATE_GROUP_SET.has(value as string) ? (value as PlaneStateGroup) : 'backlog'
}

export function mapPlaneProject(record: PlaneRecord, client: PlaneClient): PlaneProject | null {
  const id = asString(record.id)
  const name = asString(record.name)
  if (!id || !name) {
    return null
  }
  return {
    id,
    identifier: asString(record.identifier) ?? '',
    name,
    ...(asString(record.description) ? { description: asString(record.description) } : {}),
    connectionId: client.connectionId,
    workspaceSlug: client.workspaceSlug
  }
}

export function mapPlaneState(record: PlaneRecord): PlaneState | null {
  const id = asString(record.id)
  const name = asString(record.name)
  if (!id || !name) {
    return null
  }
  return {
    id,
    name,
    color: asString(record.color) ?? '#60646C',
    group: toStateGroup(record.group),
    isDefault: record.default === true
  }
}

export function mapPlaneMember(record: PlaneRecord): PlaneMember | null {
  const id = asString(record.id)
  if (!id) {
    return null
  }
  const first = asString(record.first_name) ?? ''
  const last = asString(record.last_name) ?? ''
  const full = `${first} ${last}`.trim()
  return {
    id,
    // Plane leaves first/last blank for members who never completed onboarding,
    // so fall back through display_name to the email local part.
    displayName: full || asString(record.display_name) || asString(record.email) || id,
    email: asString(record.email) ?? null,
    ...(asString(record.avatar_url) ? { avatarUrl: asString(record.avatar_url) } : {})
  }
}

export async function listProjects(
  client: PlaneClient,
  signal?: AbortSignal
): Promise<PlaneProject[]> {
  const records = await fetchAllPages<unknown>(
    client,
    workspacePath(client.workspaceSlug, 'projects/'),
    signal ? { signal } : undefined
  )
  return records
    .map((record) => mapPlaneProject(asRecord(record), client))
    .filter((project): project is PlaneProject => project !== null)
}

export async function listProjectStates(
  client: PlaneClient,
  projectId: string,
  signal?: AbortSignal
): Promise<PlaneState[]> {
  const records = await fetchAllPages<unknown>(
    client,
    projectPath(client.workspaceSlug, projectId, 'states/'),
    signal ? { signal } : undefined
  )
  return records
    .map((record) => mapPlaneState(asRecord(record)))
    .filter((state): state is PlaneState => state !== null)
    .sort(
      (left, right) =>
        PLANE_STATE_GROUPS.indexOf(left.group) - PLANE_STATE_GROUPS.indexOf(right.group)
    )
}

export async function listWorkspaceMembers(
  client: PlaneClient,
  signal?: AbortSignal
): Promise<PlaneMember[]> {
  const records = await fetchAllPages<unknown>(
    client,
    workspacePath(client.workspaceSlug, 'members/'),
    signal ? { signal } : undefined
  )
  return records
    .map((record) => mapPlaneMember(asRecord(record)))
    .filter((member): member is PlaneMember => member !== null)
}
