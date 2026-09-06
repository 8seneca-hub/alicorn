import type { BoardAutomationRule } from '../../shared/global-settings-types'

export type BoardAutomationStatusView = {
  killed: boolean
  globalDisabledAt: string | null
  globalDisabledBy: string | null
  boardDisabledAt: string | null
  boardDisabledBy: string | null
  lastRefusal: { outcome: string; at: string; toStatusId: string } | null
}

export type BoardAutomationApi = {
  status: (args: { repoId: string }) => Promise<BoardAutomationStatusView | null>
  setKilled: (args: { repoId?: string; killed: boolean; by?: string }) => Promise<{ ok: boolean }>
  listRules: (args: { repoId?: string }) => Promise<{ rules: BoardAutomationRule[] }>
  saveRules: (args: {
    repoId: string
    rules: BoardAutomationRule[]
  }) => Promise<{ ok: boolean; rules?: BoardAutomationRule[] }>
}
