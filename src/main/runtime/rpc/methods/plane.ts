import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'

const ConnectionSelection = z
  .object({
    connectionId: OptionalString
  })
  .optional()

const Connect = z.object({
  baseUrl: requiredString('Plane URL is required'),
  workspaceSlug: requiredString('Workspace slug is required'),
  apiKey: requiredString('API key is required')
})

const ProjectScope = z.object({
  projectId: requiredString('Project id is required'),
  connectionId: OptionalString
})

const ListIssues = z.object({
  projectId: requiredString('Project id is required'),
  projectIdentifier: OptionalString,
  orderBy: OptionalString,
  connectionId: OptionalString
})

const GetIssue = z.object({
  projectId: requiredString('Project id is required'),
  issueId: requiredString('Issue id is required'),
  projectIdentifier: OptionalString,
  connectionId: OptionalString
})

// Adding methods is wire-safe: a client calling these against a host that does
// not register them gets a structured `method_not_found` rather than silence,
// so the absence is visible without a capability gate.
export const PLANE_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'plane.connect',
    params: Connect,
    handler: async (params, { runtime }) =>
      runtime.planeConnect({
        baseUrl: params.baseUrl.trim(),
        workspaceSlug: params.workspaceSlug.trim(),
        apiKey: params.apiKey.trim()
      })
  }),
  defineMethod({
    name: 'plane.disconnect',
    params: ConnectionSelection,
    handler: async (params, { runtime }) => runtime.planeDisconnect(params?.connectionId)
  }),
  defineMethod({
    name: 'plane.status',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeStatus()
  }),
  defineMethod({
    name: 'plane.setDefaultProject',
    params: z.object({
      connectionId: requiredString('Connection id is required'),
      projectId: OptionalString
    }),
    handler: async (params, { runtime }) =>
      runtime.planeSetDefaultProject(params.connectionId.trim(), params.projectId ?? null)
  }),
  defineMethod({
    name: 'plane.listProjects',
    params: ConnectionSelection,
    handler: async (params, { runtime }) => runtime.planeListProjects(params?.connectionId)
  }),
  defineMethod({
    name: 'plane.listStates',
    params: ProjectScope,
    handler: async (params, { runtime }) =>
      runtime.planeListStates(params.projectId.trim(), params.connectionId)
  }),
  defineMethod({
    name: 'plane.listMembers',
    params: ConnectionSelection,
    handler: async (params, { runtime }) => runtime.planeListMembers(params?.connectionId)
  }),
  defineMethod({
    name: 'plane.listIssues',
    params: ListIssues,
    handler: async (params, { runtime }) =>
      runtime.planeListIssues(params.projectId.trim(), {
        ...(params.projectIdentifier ? { projectIdentifier: params.projectIdentifier } : {}),
        ...(params.orderBy ? { orderBy: params.orderBy } : {}),
        ...(params.connectionId ? { connectionId: params.connectionId } : {})
      })
  }),
  defineMethod({
    name: 'plane.getIssue',
    params: GetIssue,
    handler: async (params, { runtime }) =>
      runtime.planeGetIssue(params.projectId.trim(), params.issueId.trim(), {
        ...(params.projectIdentifier ? { projectIdentifier: params.projectIdentifier } : {}),
        ...(params.connectionId ? { connectionId: params.connectionId } : {})
      })
  })
]
