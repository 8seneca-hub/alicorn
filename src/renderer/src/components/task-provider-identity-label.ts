import type { TaskProviderIdentity } from '../../../shared/task-source-context'

// How each provider names the thing a task list is scoped to: a repo for the
// code hosts, a workspace or site for the trackers.
export function getTaskProviderIdentityLabel(
  identity: TaskProviderIdentity | null | undefined
): string | null {
  if (!identity) {
    return null
  }
  switch (identity.provider) {
    case 'github':
      return `${identity.owner}/${identity.repo}`
    case 'gitlab':
      return identity.namespace && identity.project
        ? `${identity.namespace}/${identity.project}`
        : (identity.projectId ?? null)
    case 'linear':
      return identity.workspaceName ?? identity.workspaceId ?? null
    case 'jira':
      return identity.siteUrl ?? identity.siteId ?? null
    case 'plane':
      return identity.workspaceSlug ?? identity.baseUrl ?? null
  }
}
