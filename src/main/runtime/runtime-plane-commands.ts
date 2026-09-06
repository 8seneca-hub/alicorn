import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState
} from '../../shared/plane-types'
import { connectPlane, disconnectPlane, getPlaneStatus } from '../plane/plane-connection'
import { attempt, withClient } from '../plane/plane-read-envelope'
import { getProjectIssue, listProjectIssues } from '../plane/plane-issue-queries'
import { updateIssueState } from '../plane/plane-issue-mutations'
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
}
