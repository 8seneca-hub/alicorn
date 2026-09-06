import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState,
  PlaneStateGroup
} from '../../shared/plane-types'
import {
  connectPlane,
  disconnectPlane,
  getPlaneStatus,
  setDefaultPlaneProject
} from '../plane/plane-connection'
import { attempt, withClient } from '../plane/plane-read-envelope'
import { addIssueComment, listIssueComments, type PlaneComment } from '../plane/plane-comments'
import { resolvePlaneIssue } from '../plane/plane-issue-resolver'
import { filterPlaneIssues, resolveStateByName } from '../plane/plane-issue-search'
import { updateIssueState } from '../plane/plane-issue-mutations'
import { getProjectIssue, listProjectIssues } from '../plane/plane-issue-queries'
import {
  listProjectStates,
  listProjects,
  listWorkspaceMembers
} from '../plane/plane-project-queries'

// Runs inside the EXECUTION HOST's main process, so the API key it reads and
// writes is that machine's — a paired client never holds the credential.
// Method names are prefixed `plane` because the runtime surface binds them by
// prefix; renaming one renames the RPC it backs.
export class RuntimePlaneCommands {
  planeConnect(args: {
    baseUrl: string
    workspaceSlug: string
    apiKey: string
  }): Promise<PlaneResult<PlaneConnectionStatus>> {
    return attempt(() => connectPlane(args))
  }

  planeDisconnect(connectionId?: string): PlaneConnectionStatus {
    return disconnectPlane(connectionId)
  }

  planeStatus(): PlaneConnectionStatus {
    return getPlaneStatus()
  }

  planeSetDefaultProject(connectionId: string, projectId: string | null): PlaneConnectionStatus {
    return setDefaultPlaneProject(connectionId, projectId)
  }

  planeListProjects(connectionId?: string): Promise<PlaneResult<PlaneProject[]>> {
    return withClient(connectionId, (client) => listProjects(client))
  }

  planeListStates(projectId: string, connectionId?: string): Promise<PlaneResult<PlaneState[]>> {
    return withClient(connectionId, (client) => listProjectStates(client, projectId))
  }

  planeListMembers(connectionId?: string): Promise<PlaneResult<PlaneMember[]>> {
    return withClient(connectionId, (client) => listWorkspaceMembers(client))
  }

  planeListIssues(
    projectId: string,
    options?: { projectIdentifier?: string; orderBy?: string; connectionId?: string }
  ): Promise<PlaneResult<PlaneIssue[]>> {
    return withClient(options?.connectionId, (client) =>
      listProjectIssues(client, projectId, {
        ...(options?.projectIdentifier ? { projectIdentifier: options.projectIdentifier } : {}),
        ...(options?.orderBy ? { orderBy: options.orderBy } : {})
      })
    )
  }

  // Why: the only write. It runs on the execution host like the reads, so a paired client moving a
  // card never needs the API key.
  planeUpdateIssueState(
    projectId: string,
    issueId: string,
    stateId: string,
    options?: { projectIdentifier?: string; connectionId?: string }
  ): Promise<PlaneResult<PlaneIssue | null>> {
    return withClient(options?.connectionId, (client) =>
      updateIssueState(
        client,
        projectId,
        issueId,
        stateId,
        options?.projectIdentifier ? { projectIdentifier: options.projectIdentifier } : {}
      )
    )
  }

  planeGetIssue(
    projectId: string,
    issueId: string,
    options?: { projectIdentifier?: string; connectionId?: string }
  ): Promise<PlaneResult<PlaneIssue | null>> {
    return withClient(options?.connectionId, (client) =>
      getProjectIssue(
        client,
        projectId,
        issueId,
        options?.projectIdentifier ? { projectIdentifier: options.projectIdentifier } : {}
      )
    )
  }

  // CLI-facing verbs. They resolve a board-readable id and a state *name*, which
  // the UI never needs because it already holds the uuids.
  planeIssueDetail(
    reference: string,
    options?: { projectId?: string; connectionId?: string }
  ): Promise<PlaneResult<{ issue: PlaneIssue; comments: PlaneComment[] }>> {
    return withClient(options?.connectionId, async (client) => {
      const { issue } = await resolvePlaneIssue(
        client,
        reference,
        options?.projectId ? { projectId: options.projectId } : undefined
      )
      const comments = await listIssueComments(client, issue.projectId, issue.id)
      return { issue, comments }
    })
  }

  planeSearchIssues(
    projectId: string,
    options?: {
      stateGroup?: PlaneStateGroup
      query?: string
      limit?: number
      projectIdentifier?: string
      connectionId?: string
    }
  ): Promise<PlaneResult<PlaneIssue[]>> {
    return withClient(options?.connectionId, async (client) => {
      const [issues, states] = await Promise.all([
        listProjectIssues(
          client,
          projectId,
          options?.projectIdentifier ? { projectIdentifier: options.projectIdentifier } : undefined
        ),
        listProjectStates(client, projectId)
      ])
      return filterPlaneIssues(issues, states, {
        ...(options?.stateGroup ? { stateGroup: options.stateGroup } : {}),
        ...(options?.query ? { query: options.query } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {})
      })
    })
  }

  planeAddComment(
    reference: string,
    body: string,
    options?: { projectId?: string; connectionId?: string }
  ): Promise<PlaneResult<PlaneComment | null>> {
    return withClient(options?.connectionId, async (client) => {
      const { issue } = await resolvePlaneIssue(
        client,
        reference,
        options?.projectId ? { projectId: options.projectId } : undefined
      )
      return addIssueComment(client, issue.projectId, issue.id, body)
    })
  }

  planeSetIssueStateByName(
    reference: string,
    stateName: string,
    options?: { projectId?: string; connectionId?: string }
  ): Promise<PlaneResult<{ issue: PlaneIssue | null; stateName: string }>> {
    return withClient(options?.connectionId, async (client) => {
      const { issue } = await resolvePlaneIssue(
        client,
        reference,
        options?.projectId ? { projectId: options.projectId } : undefined
      )
      const states = await listProjectStates(client, issue.projectId)
      const resolved = resolveStateByName(states, stateName)
      if (!('state' in resolved)) {
        const options_ = resolved.candidates.length
          ? resolved.candidates.map((s) => s.name).join(', ')
          : states.map((s) => s.name).join(', ')
        throw new Error(`"${stateName}" does not name one state. Candidates: ${options_}.`)
      }
      const updated = await updateIssueState(client, issue.projectId, issue.id, resolved.state.id)
      return { issue: updated, stateName: resolved.state.name }
    })
  }
}
