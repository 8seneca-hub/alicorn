import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { PlaneIssue, PlaneProject } from '../../../../../shared/plane-types'

/**
 * Opens the workspace composer for a Plane issue, carrying the link the
 * worktree will persist.
 *
 * All four identifiers travel: the uuid the API addresses, the sequence a human
 * reads, and the slug plus project id needed to rebuild a URL back to it.
 */
export function usePlaneStartWork(): (issue: PlaneIssue) => void {
  const openModal = useAppStore((s) => s.openModal)
  const status = useAppStore((s) => s.planeStatus)
  const projectsCache = useAppStore((s) => s.planeProjectsCache)

  return useCallback(
    (issue: PlaneIssue) => {
      const connection = status.connections?.find(
        (candidate) => candidate.id === status.activeConnectionId
      )
      const projects: PlaneProject[] = Object.values(projectsCache).flatMap(
        (entry) => entry.data ?? []
      )
      const project = projects.find((candidate) => candidate.id === issue.projectId)
      openModal('new-workspace-composer', {
        linkedWorkItem: {
          type: 'issue',
          provider: 'plane',
          number: issue.sequenceId,
          title: `${issue.readableId} ${issue.name}`,
          url: issue.webUrl ?? '',
          planeIdentifier: issue.readableId
        },
        prefilledName: `${issue.readableId} ${issue.name}`,
        telemetrySource: 'sidebar',
        ...(connection && project
          ? {
              linkedPlaneIssue: issue.id,
              linkedPlaneIssueSequence: issue.sequenceId,
              linkedPlaneWorkspaceSlug: connection.workspaceSlug,
              linkedPlaneProjectId: project.id
            }
          : {})
      })
    },
    [openModal, projectsCache, status]
  )
}
