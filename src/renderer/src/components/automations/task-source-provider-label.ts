import type { TaskSourceContext } from '../../../../shared/task-source-context'

// The display name for a task provider, kept in one place so a new provider
// cannot be labelled in one automation surface and left unlabelled in another.
export function getTaskSourceProviderLabel(provider: TaskSourceContext['provider']): string {
  switch (provider) {
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    case 'linear':
      return 'Linear'
    case 'jira':
      return 'Jira'
    case 'plane':
      return 'Plane'
  }
}
