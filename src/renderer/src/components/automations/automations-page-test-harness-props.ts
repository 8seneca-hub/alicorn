/**
 * The props the stand-in children record, so a test can read back what the page handed them.
 *
 * Shapes only — no mocks, no mount — which is what lets the harness itself stay the size of a rig.
 */
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import type { AutomationHostCatalogView } from './use-automation-host-catalog'
import type { AutomationCreateDestinationControl } from './use-automation-create-destination'
import type { ExternalAutomationListEntry } from './external-automation-list-entries'
import type { AutomationListRow } from './automation-list-row-identity'

export type ListPanelProps = {
  filteredExternalAutomationEntries: ExternalAutomationListEntry[]
  selectedExternal: ExternalAutomationListEntry | null
  openEditExternalDialog: (
    manager: ExternalAutomationListEntry['manager'],
    job: ExternalAutomationListEntry['job'],
    scope: ExternalAutomationListEntry['scope']
  ) => void
  externalActionKey: string | null
  requestExternalAction: (
    manager: ExternalAutomationListEntry['manager'],
    job: ExternalAutomationListEntry['job'],
    action: 'run' | 'pause' | 'resume' | 'delete',
    scope: ExternalAutomationListEntry['scope']
  ) => void
  hasListItems: boolean
  hasFilteredListItems: boolean
  filteredRows: readonly AutomationListRow[]
  selectedRowKey: string | null
  selectedExternalKey: string | null
  hostCatalog: AutomationHostCatalogView
  searchCounts: { hostRowCount: number; visibleRowCount: number; searchActive: boolean }
  externalManagersUncheckedNotice: string | null
  isActionEnabled: (row: AutomationListRow, action: string) => boolean
  onSelectHost: (filter: unknown) => void
  selectAutomationRow: (rowKey: string | null) => void
  selectExternalKey: (entryKey: string | null) => void
  onOpenDetail: () => void
  onRefresh: () => void
  runNow: (row: AutomationListRow) => void
  openEditDialog: (row: AutomationListRow) => void
  toggleAutomation: (row: AutomationListRow) => void
  requestDeleteAutomation: (row: AutomationListRow) => void
  openCreateDialog: () => void
  canCreateAutomation: boolean
}

export type DetailPaneProps = {
  selected: Automation | null
  selectedHostEntry: AutomationHostCatalogEntry | null
  selectedRuns: AutomationRun[]
  selectedRunsNotice: { message: string } | null
  runNow: (automation: Automation) => void
  toggleAutomation: (automation: Automation) => void
  requestDeleteAutomation: (automation: Automation) => void
  openEditDialog: (automation: Automation) => void
  fetchExternalAutomationRuns: (input: {
    scope: ExternalAutomationListEntry['scope']
    manager: ExternalAutomationListEntry['manager']
    job: ExternalAutomationListEntry['job']
    page: number
    pageSize: number
  }) => Promise<unknown>
}

export type EditorDialogProps = {
  open: boolean
  isEditing: boolean
  createDestination?: AutomationCreateDestinationControl
  editDestination?: AutomationCreateDestinationControl
  notice?: { message: string; recovery: string | null } | null
  onNoticeRecover?: (action: string) => void
  repos?: { id: string }[]
  draft?: { projectId: string; workspaceId: string }
  onSave: () => void
  onDraftChange: (updater: (current: unknown) => unknown) => void
}

export type DeleteDialogProps = {
  deleteTarget: Automation | null
  onConfirm: () => void
}
