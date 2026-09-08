import { useMemo } from 'react'
import {
  Plug,
  Files,
  GitBranch,
  ListChecks,
  Microscope,
  Network,
  ScrollText,
  ShieldQuestion,
  SquareTerminal,
  Workflow
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useRepoById } from '@/store/selectors'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { getVisibleRightSidebarActivityItems } from './right-sidebar-activity-visibility'
import { getPluginPanelActivityItems } from './plugin-panel-activity-items'
import {
  collectInstalledPluginTabKeys,
  usePluginPanels,
  usePluginPanelsStore,
  type PluginPanelsFetchStatus
} from '@/store/plugin-panels'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { AgentSessionHistoryIcon } from './agent-session-history-icon'
import type { ActivityBarItem } from './activity-bar-buttons'

export type RightSidebarActivityItems = {
  visibleItems: ActivityBarItem[]
  activeFolderWorkspaceKey: string | null
  pluginSystemEnabled: boolean
  pluginFetchStatus: PluginPanelsFetchStatus
  installedPluginTabKeys: Set<string>
}

export function useRightSidebarActivityItems({
  rightSidebarOpen
}: {
  rightSidebarOpen: boolean
}): RightSidebarActivityItems {
  const explorerShortcut = useShortcutLabel('sidebar.explorer.toggle')
  const sourceControlShortcut = useShortcutLabel('sidebar.sourceControl.toggle')
  const checksShortcut = useShortcutLabel('sidebar.checks.toggle')
  const portsShortcut = useShortcutLabel('sidebar.ports.toggle')
  const terminalShortcut = useShortcutLabel('sidebar.terminal.toggle')
  const activeWorktreeId = useAppStore((s) => (rightSidebarOpen ? s.activeWorktreeId : null))
  // Why: source control and checks are meaningless for non-git folders.
  // Hide those tabs so the activity bar only shows relevant actions.
  const activeWorktree = useAppStore((s) =>
    activeWorktreeId ? (s.getKnownWorktreeById(activeWorktreeId) ?? null) : null
  )
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const activeWorkspaceScope = parseWorkspaceKey(activeWorktreeId ?? '')
  const isFolderWorkspace = activeWorkspaceScope?.type === 'folder'
  const isFolder = isFolderWorkspace || (activeRepo ? isFolderRepo(activeRepo) : false)
  const isSshRepo = Boolean(activeRepo?.connectionId)
  const pluginSystemEnabled = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  const pluginPanels = usePluginPanels()
  const visiblePluginPanels = useMemo(
    () => (pluginSystemEnabled ? pluginPanels : []),
    [pluginPanels, pluginSystemEnabled]
  )
  const installedPlugins = usePluginPanelsStore((s) => s.plugins)
  const pluginFetchStatus = usePluginPanelsStore((s) => s.fetchStatus)
  const pluginPanelErrors = usePluginPanelsStore((s) => s.panelErrors)
  const installedPluginTabKeys = useMemo(
    () => collectInstalledPluginTabKeys(installedPlugins),
    [installedPlugins]
  )

  const activityItems = useMemo<ActivityBarItem[]>(
    () => [
      {
        id: 'explorer',
        icon: Files,
        title: translate('auto.components.right.sidebar.index.8bc2bbc3a0', 'Explorer'),
        shortcut: explorerShortcut === 'Unassigned' ? '' : explorerShortcut
      },
      {
        id: 'vault',
        icon: AgentSessionHistoryIcon,
        title: translate('auto.components.right.sidebar.index.aiVaultSessionHistory', 'Agents'),
        shortcut: ''
      },
      {
        id: 'workspaces',
        icon: Workflow,
        title: translate(
          'auto.components.right.sidebar.index.folderWorkspaces',
          'Attached worktrees'
        ),
        shortcut: '',
        folderOnly: true
      },
      {
        id: 'pr-checks',
        icon: ListChecks,
        title: translate('auto.components.right.sidebar.index.parentPrChecks', 'PR Checks'),
        shortcut: '',
        folderOnly: true
      },
      {
        id: 'source-control',
        icon: GitBranch,
        title: translate('auto.components.right.sidebar.index.0314901467', 'Source Control'),
        shortcut: sourceControlShortcut === 'Unassigned' ? '' : sourceControlShortcut,
        gitOnly: true
      },
      {
        id: 'checks',
        icon: ListChecks,
        title: translate('auto.components.right.sidebar.index.83a10e3c44', 'Checks'),
        shortcut: checksShortcut === 'Unassigned' ? '' : checksShortcut,
        gitOnly: true
      },
      {
        id: 'ports',
        icon: Plug,
        title: translate('auto.components.right.sidebar.index.441733b630', 'Ports'),
        shortcut: portsShortcut === 'Unassigned' ? '' : portsShortcut,
        sshOnly: true
      },
      {
        id: 'run',
        icon: Network,
        // Why no shortcut: an orchestrated run is the exception, not the daily path, so it does
        // not earn a chord ahead of Explorer or Source Control.
        title: translate(
          'auto.components.right.sidebar.use.right.sidebar.activity.items.7f0215bd93',
          'Run'
        ),
        shortcut: ''
      },
      {
        id: 'provenance',
        // Why gitOnly: the ledger keys a run by repo and branch, and a folder workspace has
        // neither — an empty panel there would read as "nothing was recorded".
        gitOnly: true,
        icon: ScrollText,
        // Why no shortcut: this is what you open when an auto-decision surprises you, not on the
        // way through, so it does not earn a chord ahead of Explorer or Source Control.
        title: translate(
          'auto.components.right.sidebar.use.right.sidebar.activity.items.provenance',
          'Provenance'
        ),
        shortcut: ''
      },
      {
        id: 'context',
        // Why gitOnly: same reason as Provenance — the ledger keys a run by repo and branch, and a
        // folder workspace has neither, so an empty panel there would read as "nothing captured".
        gitOnly: true,
        icon: Microscope,
        // Why no shortcut: you open this when a member's answer surprises you, not on the way
        // through, so it does not earn a chord ahead of Explorer or Source Control.
        title: translate(
          'auto.components.right.sidebar.use.right.sidebar.activity.items.context',
          'Context'
        ),
        shortcut: ''
      },
      {
        id: 'gates',
        icon: ShieldQuestion,
        // Why no shortcut: a gate is an interruption you are already being pulled into, usually
        // from a notification — it does not earn a chord ahead of Explorer or Source Control.
        title: translate(
          'auto.components.right.sidebar.use.right.sidebar.activity.items.gates',
          'Gates'
        ),
        shortcut: ''
      },
      {
        id: 'terminal',
        icon: SquareTerminal,
        // Why here and not the main area: an ADE opens an agent by default, so the shell lives
        // one keystroke away rather than in the tab you were going to brief someone in.
        title: translate(
          'auto.components.right.sidebar.use.right.sidebar.activity.items.terminal',
          'Terminal'
        ),
        shortcut: terminalShortcut === 'Unassigned' ? '' : terminalShortcut
      },
      // Why: plugin panels append after the built-in tabs so core navigation
      // keeps stable positions regardless of which plugins are installed.
      ...getPluginPanelActivityItems(visiblePluginPanels, pluginPanelErrors)
    ],
    [
      checksShortcut,
      explorerShortcut,
      pluginPanelErrors,
      visiblePluginPanels,
      portsShortcut,
      terminalShortcut,
      sourceControlShortcut
    ]
  )

  const visibleItems = useMemo(
    () =>
      getVisibleRightSidebarActivityItems(activityItems, {
        isFolder,
        isFolderWorkspace,
        isSshRepo
      }),
    [activityItems, isFolder, isFolderWorkspace, isSshRepo]
  )

  const activeFolderWorkspaceKey = isFolderWorkspace ? (activeWorktreeId ?? null) : null

  return {
    visibleItems,
    activeFolderWorkspaceKey,
    pluginSystemEnabled,
    pluginFetchStatus,
    installedPluginTabKeys
  }
}
