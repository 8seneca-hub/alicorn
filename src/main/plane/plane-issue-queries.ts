import { PLANE_PRIORITIES, type PlaneIssue, type PlanePriority } from '../../shared/plane-types'
import {
  asNumber,
  asRecord,
  asString,
  asStringArray,
  fetchAllPages,
  withQuery,
  type PlaneRecord
} from './plane-record-pages'
import { planeRequest, projectPath, type PlaneClient } from './plane-request'

const PRIORITY_SET = new Set<string>(PLANE_PRIORITIES)

function toPriority(value: unknown): PlanePriority {
  // Plane serialises priority either as a bare string or, on some list
  // endpoints, as { id, label, key } — accept both rather than losing it.
  const direct = typeof value === 'string' ? value : asString(asRecord(value).id)
  return PRIORITY_SET.has(direct as string) ? (direct as PlanePriority) : 'none'
}

// The same field is a bare uuid on detail reads and { id, name, ... } on list
// reads, so relation ids are read through one coercion.
function toRelationId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  return asString(asRecord(value).id) ?? null
}

export function issueWebUrl(
  baseUrl: string,
  workspaceSlug: string,
  projectId: string,
  issueId: string
): string {
  return `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${issueId}`
}

export function mapPlaneIssue(
  record: PlaneRecord,
  client: PlaneClient,
  projectIdentifier?: string
): PlaneIssue | null {
  const id = asString(record.id)
  const name = asString(record.name)
  const projectId = toRelationId(record.project)
  if (!id || !name || !projectId) {
    return null
  }
  const sequenceId = asNumber(record.sequence_id) ?? 0
  // `created_at`/`updated_at` are not defaulted to now: reporting that reads
  // them would silently record the fetch time as the issue's timestamps.
  const createdAt = asString(record.created_at) ?? ''
  return {
    id,
    sequenceId,
    readableId: projectIdentifier ? `${projectIdentifier}-${sequenceId}` : String(sequenceId),
    name,
    descriptionHtml: asString(record.description_html) ?? '',
    priority: toPriority(record.priority),
    stateId: toRelationId(record.state),
    projectId,
    assigneeIds: asStringArray(record.assignees),
    labelIds: asStringArray(record.labels),
    parentId: toRelationId(record.parent),
    startDate: asString(record.start_date) ?? null,
    targetDate: asString(record.target_date) ?? null,
    createdAt,
    updatedAt: asString(record.updated_at) ?? createdAt,
    completedAt: asString(record.completed_at) ?? null,
    isDraft: record.is_draft === true,
    connectionId: client.connectionId,
    webUrl: issueWebUrl(client.baseUrl, client.workspaceSlug, projectId, id)
  }
}

export type ListProjectIssuesOptions = {
  projectIdentifier?: string
  /** Plane orders by `-created_at` by default; pass e.g. `-updated_at` to change it. */
  orderBy?: string
  signal?: AbortSignal
}

export async function listProjectIssues(
  client: PlaneClient,
  projectId: string,
  options?: ListProjectIssuesOptions
): Promise<PlaneIssue[]> {
  const path = withQuery(projectPath(client.workspaceSlug, projectId, 'issues/'), {
    order_by: options?.orderBy
  })
  const records = await fetchAllPages<unknown>(
    client,
    path,
    options?.signal ? { signal: options.signal } : undefined
  )
  return records
    .map((record) => mapPlaneIssue(asRecord(record), client, options?.projectIdentifier))
    .filter((issue): issue is PlaneIssue => issue !== null)
}

export async function getProjectIssue(
  client: PlaneClient,
  projectId: string,
  issueId: string,
  options?: { projectIdentifier?: string; signal?: AbortSignal }
): Promise<PlaneIssue | null> {
  const record = await planeRequest<unknown>(
    client,
    projectPath(client.workspaceSlug, projectId, `issues/${encodeURIComponent(issueId)}/`),
    options?.signal ? { signal: options.signal } : undefined
  )
  return mapPlaneIssue(asRecord(record), client, options?.projectIdentifier)
}
