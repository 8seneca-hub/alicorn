import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'
import {
  BOARD_KILL_SCOPE_GLOBAL,
  boardKillScope,
  getBoardAutomationStatus,
  setBoardAutomationKilled
} from '../../../board-automation/board-kill-switch'

const REFUSAL_WINDOW_MS = 86_400_000

const RepoScope = z.object({ repoId: requiredString('A repo id is required') })

const SetKilled = z.object({
  repoId: OptionalString,
  killed: z.boolean(),
  by: OptionalString
})

// Why an RPC and not only IPC: the stop has to work from the CLI on the host that owns the board —
// including over SSH, and when the window is gone or the UI is wedged.
export const BOARD_AUTOMATION_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'boardAutomation.status',
    params: RepoScope,
    handler: async (params, { runtime }) =>
      getBoardAutomationStatus(runtime.getOrchestrationDb(), params.repoId.trim(), {
        lastRefusalSinceMs: Date.now() - REFUSAL_WINDOW_MS
      })
  }),
  defineMethod({
    name: 'boardAutomation.setKilled',
    params: SetKilled,
    handler: async (params, { runtime }) => {
      // Why global when no repo is named: it is what someone reaches for before they know which
      // board is misbehaving, and it holds however many boards exist.
      const scope = params.repoId ? boardKillScope(params.repoId.trim()) : BOARD_KILL_SCOPE_GLOBAL
      setBoardAutomationKilled(
        runtime.getOrchestrationDb(),
        scope,
        params.killed ? (params.by ?? 'cli') : null
      )
      return { scope, killed: params.killed }
    }
  })
]
