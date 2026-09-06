import type { RuntimeLinearSettings } from '@/runtime/runtime-linear-client'
import type {
  WorkspaceStatus,
  WorkspaceStatusDefinition,
  Worktree
} from '../../../../shared/worktree/types'
import { getWorkspaceStatus } from '../../../../shared/workspace-statuses'
import {
  defaultLinearBoardStatusSyncDeps,
  syncLinearWorktreeStatus
} from './workspace-board-linear-status-sync'
import type { LinearBoardStatusSyncDependencies } from './workspace-board-linear-status-sync'
import type { RuntimePlaneSettings } from '@/runtime/runtime-plane-client'
import { runPlaneWorktreeStatusSync } from './sync-plane-worktree-status'

export type WorkspaceBoardTaskStatusSyncResult = {
  updated: number
  skipped: number
  failed: number
  messages: WorkspaceBoardTaskStatusSyncMessage[]
}

// Which tracker a message came from: one board syncs both Linear and Plane
// worktrees, so naming the wrong one in a toast is worse than naming none.
export type TaskStatusSyncProvider = 'linear' | 'plane'

export type WorkspaceBoardTaskStatusSyncMessage =
  | { kind: 'issue-read-failed'; provider: TaskStatusSyncProvider; issueIdentifier: string }
  | { kind: 'missing-workflow-state'; provider: TaskStatusSyncProvider; statusLabel: string }
  | { kind: 'ambiguous-workflow-state'; provider: TaskStatusSyncProvider; statusLabel: string }
  | {
      kind: 'update-failed'
      provider: TaskStatusSyncProvider
      issueIdentifier: string
      detail?: string
    }
  | {
      kind: 'provider-error'
      provider: TaskStatusSyncProvider
      issueIdentifier: string
      detail?: string
    }
  // Raised by the caller when the sync itself threw, so no tracker is implicated.
  | { kind: 'unexpected-error'; detail?: string }

export type SyncWorkspaceBoardTaskStatusesArgs = {
  worktreeIds: readonly string[]
  targetStatus: WorkspaceStatusDefinition
  worktreesById: ReadonlyMap<
    string,
    Pick<
      Worktree,
      | 'linkedLinearIssue'
      | 'linkedLinearIssueWorkspaceId'
      | 'linkedPlaneIssue'
      | 'linkedPlaneProjectId'
    >
  >
  settings?: RuntimeLinearSettings
  getSettingsForWorktree?: (worktreeId: string) => RuntimeLinearSettings
  getLatestWorkspaceStatus: (worktreeId: string) => WorkspaceStatus | null | undefined
  deps?: Partial<LinearBoardStatusSyncDependencies>
}

export type WorkspaceBoardTaskStatusSyncRequest = {
  worktreeIds: string[]
  targetStatus: WorkspaceStatusDefinition
}

export function getWorkspaceBoardTaskStatusSyncRequest(args: {
  enabled: boolean
  worktreeIds: readonly string[]
  status: WorkspaceStatus
  worktreesById: ReadonlyMap<string, Pick<Worktree, 'workspaceStatus'>>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): WorkspaceBoardTaskStatusSyncRequest | null {
  if (!args.enabled || args.worktreeIds.length === 0) {
    return null
  }
  const targetStatus = args.workspaceStatuses.find((item) => item.id === args.status)
  if (!targetStatus) {
    return null
  }
  const changedWorktreeIds = [...new Set(args.worktreeIds)].filter((worktreeId) => {
    const worktree = args.worktreesById.get(worktreeId)
    return worktree ? getWorkspaceStatus(worktree, args.workspaceStatuses) !== args.status : false
  })
  if (changedWorktreeIds.length === 0) {
    return null
  }
  return { worktreeIds: changedWorktreeIds, targetStatus }
}

const worktreeSyncQueues = new Map<string, Promise<unknown>>()

function getMessageKey(message: WorkspaceBoardTaskStatusSyncMessage): string {
  return JSON.stringify(message)
}

function addMessage(
  result: WorkspaceBoardTaskStatusSyncResult,
  message: WorkspaceBoardTaskStatusSyncMessage
): void {
  const key = getMessageKey(message)
  if (!result.messages.some((item) => getMessageKey(item) === key)) {
    result.messages.push(message)
  }
}

function skipped(
  result: WorkspaceBoardTaskStatusSyncResult,
  message?: WorkspaceBoardTaskStatusSyncMessage
): WorkspaceBoardTaskStatusSyncResult {
  result.skipped += 1
  if (message) {
    addMessage(result, message)
  }
  return result
}

function failed(
  result: WorkspaceBoardTaskStatusSyncResult,
  message: WorkspaceBoardTaskStatusSyncMessage
): WorkspaceBoardTaskStatusSyncResult {
  result.failed += 1
  addMessage(result, message)
  return result
}

function mergeResult(
  aggregate: WorkspaceBoardTaskStatusSyncResult,
  item: WorkspaceBoardTaskStatusSyncResult
): void {
  aggregate.updated += item.updated
  aggregate.skipped += item.skipped
  aggregate.failed += item.failed
  for (const message of item.messages) {
    addMessage(aggregate, message)
  }
}

async function enqueueWorktreeSync(
  worktreeId: string,
  task: () => Promise<WorkspaceBoardTaskStatusSyncResult>
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const previous = worktreeSyncQueues.get(worktreeId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  const cleanup = next.finally(() => {
    if (worktreeSyncQueues.get(worktreeId) === cleanup) {
      worktreeSyncQueues.delete(worktreeId)
    }
  })
  worktreeSyncQueues.set(worktreeId, cleanup)
  return next
}

async function syncPlaneLinkedWorktree(
  args: SyncWorkspaceBoardTaskStatusesArgs,
  worktreeId: string
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const result: WorkspaceBoardTaskStatusSyncResult = {
    updated: 0,
    skipped: 0,
    failed: 0,
    messages: []
  }
  const worktree = args.worktreesById.get(worktreeId)
  if (!worktree?.linkedPlaneIssue) {
    return skipped(result)
  }
  const settings = args.getSettingsForWorktree
    ? args.getSettingsForWorktree(worktreeId)
    : args.settings
  try {
    const written = await runPlaneWorktreeStatusSync({
      worktree: { ...worktree, id: worktreeId },
      targetStatus: args.targetStatus,
      settings: settings as RuntimePlaneSettings,
      getLatestWorkspaceStatus: (id) => args.getLatestWorkspaceStatus(id)
    })
    if (written.outcome === 'updated') {
      result.updated += 1
      return result
    }
    if (written.outcome === 'failed') {
      return failed(result, {
        kind: 'update-failed',
        provider: 'plane',
        issueIdentifier: worktree.linkedPlaneIssue,
        detail: written.detail
      })
    }
    if (written.outcome === 'ambiguous') {
      return skipped(result, {
        kind: 'ambiguous-workflow-state',
        provider: 'plane',
        statusLabel: args.targetStatus.label
      })
    }
    return skipped(result)
  } catch (error) {
    return failed(result, {
      kind: 'provider-error',
      provider: 'plane',
      issueIdentifier: worktree.linkedPlaneIssue,
      detail: error instanceof Error ? error.message : undefined
    })
  }
}

export async function syncWorkspaceBoardTaskStatuses(
  args: SyncWorkspaceBoardTaskStatusesArgs
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const deps = { ...defaultLinearBoardStatusSyncDeps, ...args.deps }
  const aggregate: WorkspaceBoardTaskStatusSyncResult = {
    updated: 0,
    skipped: 0,
    failed: 0,
    messages: []
  }

  const uniqueIds = new Set(args.worktreeIds)
  await Promise.all(
    [...uniqueIds].map(async (worktreeId) => {
      const item = await enqueueWorktreeSync(worktreeId, () =>
        args.worktreesById.get(worktreeId)?.linkedPlaneIssue
          ? syncPlaneLinkedWorktree(args, worktreeId)
          : syncLinearWorktreeStatus(args, worktreeId, deps)
      )
      mergeResult(aggregate, item)
    })
  )

  return aggregate
}
