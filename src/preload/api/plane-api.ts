import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState
} from '../../shared/plane-types'

export type { PlaneResult }

export type PlaneApi = {
  connect: (args: {
    baseUrl: string
    workspaceSlug: string
    apiKey: string
  }) => Promise<PlaneResult<PlaneConnectionStatus>>
  disconnect: (args?: { connectionId?: string }) => Promise<PlaneConnectionStatus>
  status: () => Promise<PlaneConnectionStatus>
  listProjects: (args?: { connectionId?: string }) => Promise<PlaneResult<PlaneProject[]>>
  listStates: (args: {
    projectId: string
    connectionId?: string
  }) => Promise<PlaneResult<PlaneState[]>>
  listMembers: (args?: { connectionId?: string }) => Promise<PlaneResult<PlaneMember[]>>
  listIssues: (args: {
    projectId: string
    projectIdentifier?: string
    orderBy?: string
    connectionId?: string
  }) => Promise<PlaneResult<PlaneIssue[]>>
  getIssue: (args: {
    projectId: string
    issueId: string
    projectIdentifier?: string
    connectionId?: string
  }) => Promise<PlaneResult<PlaneIssue | null>>
  updateIssueState: (args: {
    projectId: string
    issueId: string
    stateId: string
    projectIdentifier?: string
    connectionId?: string
  }) => Promise<PlaneResult<PlaneIssue | null>>
}
