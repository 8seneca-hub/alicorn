import type { PlaneIssue, PlaneProject } from '../../shared/plane-types'
import type { PlaneClient } from './plane-request'
import { getProjectIssue, listProjectIssues } from './plane-issue-queries'
import { listProjects } from './plane-project-queries'
import {
  findIssueBySequence,
  findProjectByIdentifier,
  parsePlaneIssueReference
} from './plane-issue-reference'

export type ResolvedPlaneIssue = { issue: PlaneIssue; project: PlaneProject | null }

export class PlaneIssueNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaneIssueNotFoundError'
  }
}

/**
 * Resolves `ALC-11` by finding the project that owns the key and matching the
 * running number. A bare uuid needs an explicit project, because Plane's detail
 * route is project-scoped and there is no workspace-wide issue lookup to fall
 * back on.
 */
export async function resolvePlaneIssue(
  client: PlaneClient,
  reference: string,
  options?: { projectId?: string }
): Promise<ResolvedPlaneIssue> {
  const parsed = parsePlaneIssueReference(reference)
  if (!parsed) {
    throw new PlaneIssueNotFoundError(
      `"${reference}" is not a Plane issue id. Use a readable id such as ALC-11, or an issue uuid with --project.`
    )
  }

  if (parsed.kind === 'uuid') {
    if (!options?.projectId) {
      throw new PlaneIssueNotFoundError(
        'An issue uuid needs --project, because Plane looks issues up inside a project.'
      )
    }
    const issue = await getProjectIssue(client, options.projectId, parsed.issueId)
    if (!issue) {
      throw new PlaneIssueNotFoundError(`No Plane issue ${parsed.issueId} in that project.`)
    }
    return { issue, project: null }
  }

  const projects = await listProjects(client)
  const project = findProjectByIdentifier(projects, parsed.projectIdentifier)
  if (!project) {
    const known = projects.map((item) => item.identifier).join(', ')
    throw new PlaneIssueNotFoundError(
      `No Plane project with key ${parsed.projectIdentifier}.${known ? ` Known keys: ${known}.` : ''}`
    )
  }

  const issues = await listProjectIssues(client, project.id, {
    projectIdentifier: project.identifier
  })
  const issue = findIssueBySequence(issues, parsed.sequenceId)
  if (!issue) {
    throw new PlaneIssueNotFoundError(
      `No issue ${parsed.projectIdentifier}-${parsed.sequenceId} in ${project.name}.`
    )
  }
  return { issue, project }
}
