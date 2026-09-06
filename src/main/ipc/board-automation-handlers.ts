import { ipcMain } from 'electron'
import { BOARD_AUTOMATION_IPC } from '../../shared/board-automation/ipc-channels'
import type { BoardAutomationRule, GlobalSettings } from '../../shared/global-settings-types'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { BoardRuleEngine, WorkspaceStatusChange } from '../board-automation/board-rule-engine'
import {
  BOARD_KILL_SCOPE_GLOBAL,
  boardKillScope,
  getBoardAutomationStatus,
  setBoardAutomationKilled,
  type BoardAutomationStatus
} from '../board-automation/board-kill-switch'

const REFUSAL_WINDOW_MS = 86_400_000

export type BoardAutomationHandlerDeps = {
  getOrchestrationDb: () => OrchestrationDb
  getSettings: () => GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  /** Absent in tests and headless modes; the status channel then does nothing. */
  engine?: BoardRuleEngine | null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// Why validate here rather than trust the pane: these rules dispatch agents that cost money, and a
// malformed rule persisted once would keep failing at dispatch time where it is far less visible.
function asRule(value: unknown): BoardAutomationRule | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Partial<BoardAutomationRule>
  const id = asNonEmptyString(raw.id)
  const repoId = asNonEmptyString(raw.repoId)
  const toStatusId = asNonEmptyString(raw.toStatusId)
  const memberId = asNonEmptyString(raw.memberId)
  if (!id || !repoId || !toStatusId || !memberId) {
    return null
  }
  return {
    id,
    repoId,
    toStatusId,
    memberId,
    promptTemplate: typeof raw.promptTemplate === 'string' ? raw.promptTemplate : '',
    enabled: raw.enabled !== false
  }
}

export function registerBoardAutomationHandlers(deps: BoardAutomationHandlerDeps): void {
  ipcMain.handle(
    BOARD_AUTOMATION_IPC.status,
    async (_event, args: { repoId?: unknown }): Promise<BoardAutomationStatus | null> => {
      const repoId = asNonEmptyString(args?.repoId)
      if (!repoId) {
        return null
      }
      return getBoardAutomationStatus(deps.getOrchestrationDb(), repoId, {
        lastRefusalSinceMs: Date.now() - REFUSAL_WINDOW_MS
      })
    }
  )

  ipcMain.handle(
    BOARD_AUTOMATION_IPC.setKilled,
    async (
      _event,
      args: { repoId?: unknown; killed?: unknown; by?: unknown }
    ): Promise<{ ok: boolean }> => {
      if (typeof args?.killed !== 'boolean') {
        return { ok: false }
      }
      const repoId = asNonEmptyString(args?.repoId)
      const scope = repoId ? boardKillScope(repoId) : BOARD_KILL_SCOPE_GLOBAL
      setBoardAutomationKilled(
        deps.getOrchestrationDb(),
        scope,
        args.killed ? (asNonEmptyString(args?.by) ?? 'ui') : null
      )
      return { ok: true }
    }
  )

  ipcMain.handle(
    BOARD_AUTOMATION_IPC.statusChanged,
    async (_event, args: Partial<WorkspaceStatusChange>): Promise<{ dispatched: boolean }> => {
      const worktreeId = asNonEmptyString(args?.worktreeId)
      const repoId = asNonEmptyString(args?.repoId)
      const toStatusId = asNonEmptyString(args?.toStatusId)
      if (!deps.engine || !worktreeId || !repoId || !toStatusId) {
        return { dispatched: false }
      }
      // Why swallow: this rides a board move. A rule that cannot dispatch must never make the card
      // fail to move, and the refusal is already recorded where the switch can show it.
      try {
        const result = await deps.engine.onWorkspaceStatusChanged({
          worktreeId,
          repoId,
          toStatusId,
          fromStatusId: asNonEmptyString(args?.fromStatusId),
          worktreePath: asNonEmptyString(args?.worktreePath) ?? '',
          issueRef: asNonEmptyString(args?.issueRef),
          workspaceName: asNonEmptyString(args?.workspaceName)
        })
        return { dispatched: result.allow }
      } catch (error) {
        console.warn('[alicorn] board automation dispatch failed', error)
        return { dispatched: false }
      }
    }
  )

  ipcMain.handle(
    BOARD_AUTOMATION_IPC.listRules,
    async (_event, args: { repoId?: unknown }): Promise<{ rules: BoardAutomationRule[] }> => {
      const repoId = asNonEmptyString(args?.repoId)
      const rules = deps.getSettings().boardAutomation?.rules ?? []
      return { rules: repoId ? rules.filter((rule) => rule.repoId === repoId) : rules }
    }
  )

  ipcMain.handle(
    BOARD_AUTOMATION_IPC.saveRules,
    async (
      _event,
      args: { repoId?: unknown; rules?: unknown }
    ): Promise<{ ok: boolean; rules?: BoardAutomationRule[] }> => {
      const repoId = asNonEmptyString(args?.repoId)
      if (!repoId || !Array.isArray(args?.rules)) {
        return { ok: false }
      }
      const incoming = args.rules.map(asRule)
      if (incoming.some((rule) => rule === null)) {
        return { ok: false }
      }
      const valid = incoming as BoardAutomationRule[]
      if (valid.some((rule) => rule.repoId !== repoId)) {
        return { ok: false }
      }
      // Why replace only this repo's slice: two project settings panes open at once must not
      // overwrite each other's boards.
      const others = (deps.getSettings().boardAutomation?.rules ?? []).filter(
        (rule) => rule.repoId !== repoId
      )
      deps.updateSettings({ boardAutomation: { rules: [...others, ...valid] } })
      return { ok: true, rules: valid }
    }
  )
}
