/**
 * Turning a PM tool's board into an Alicorn project.
 *
 * The mapping is small and deliberately lossy: a task carries the issue's title, its body as
 * context, and a `source` that points back. Priority, assignee and labels are *not* copied —
 * Alicorn decides who works on a task from the project's members and its workflow stage, and a
 * copied assignee would be a second answer to that question which nothing keeps in sync.
 *
 * Everything here is pure so the import can be reasoned about without a PM connection: the dialog
 * previews exactly what it will create by running these functions over what it fetched.
 */
import type { PlaneIssue, PlaneState, PlaneStateGroup } from '../plane-types'
import type { TaskInput } from './tasks'

/** Plane's state groups that mean "still to do". `completed` and `cancelled` are finished. */
const OPEN_STATE_GROUPS: readonly PlaneStateGroup[] = ['backlog', 'unstarted', 'started']

export type PlaneImportIssue = Pick<
  PlaneIssue,
  'id' | 'readableId' | 'name' | 'descriptionHtml' | 'stateId'
>

export function isOpenPlaneIssue(
  issue: Pick<PlaneImportIssue, 'stateId'>,
  states: readonly Pick<PlaneState, 'id' | 'group'>[]
): boolean {
  const state = states.find((candidate) => candidate.id === issue.stateId)
  // An issue whose state we cannot resolve counts as open: hiding work because a lookup failed is
  // worse than importing one ticket too many, which a person can close.
  return state ? OPEN_STATE_GROUPS.includes(state.group) : true
}

/** Plane descriptions are HTML; a task's context is plain text an agent reads in a prompt. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A project key from the PM project's own identifier, which Plane already shapes like one (`ALC`).
 * Falls back to the name when it does not fit, and the caller can always overtype it.
 */
export function planeProjectKey(identifier: string, name: string): string {
  const fromIdentifier = identifier.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const candidate = /^[A-Z]/.test(fromIdentifier)
    ? fromIdentifier.slice(0, 10)
    : name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4)
  return candidate.length >= 2 ? candidate : ''
}

export function planeIssueToTask(
  issue: PlaneImportIssue,
  options: { projectUrl?: string | null } = {}
): Omit<TaskInput, 'projectId'> {
  return {
    title: issue.name,
    context: htmlToPlainText(issue.descriptionHtml ?? ''),
    column: 'todo',
    executionStrategy: 'single',
    stageKey: null,
    memberIds: [],
    source: {
      provider: 'plane',
      ref: issue.readableId,
      url: options.projectUrl ? `${options.projectUrl.replace(/\/$/, '')}/${issue.id}` : null
    }
  }
}
