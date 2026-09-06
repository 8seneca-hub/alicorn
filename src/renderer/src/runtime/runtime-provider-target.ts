import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { getActiveRuntimeTarget } from './runtime-rpc-client'

// Which host answers a task-provider read: the environment a task source was
// read from when one is given, otherwise the active runtime environment.
// Nothing here is provider-specific — every tracker resolves its host the same way.
export type RuntimeProviderSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | TaskSourceContext
  | null
  | undefined

function isTaskSourceRuntimeSettings(
  settings: RuntimeProviderSettings
): settings is TaskSourceContext {
  return settings !== null && settings !== undefined && 'kind' in settings
}

export function getProviderRuntimeTarget(
  settings: RuntimeProviderSettings
): ReturnType<typeof getActiveRuntimeTarget> {
  return getActiveRuntimeTarget(
    isTaskSourceRuntimeSettings(settings) ? getTaskSourceRuntimeSettings(settings) : settings
  )
}
