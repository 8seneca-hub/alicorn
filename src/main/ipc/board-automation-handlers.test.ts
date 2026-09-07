import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { BOARD_AUTOMATION_IPC } from '../../shared/board-automation/ipc-channels'
import type { BoardAutomationRule, GlobalSettings } from '../../shared/global-settings-types'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { registerBoardAutomationHandlers } from './board-automation-handlers'
import type { BoardRuleEngine } from '../board-automation/board-rule-engine'

const RULE: BoardAutomationRule = {
  id: 'rule-1',
  repoId: 'repo-1',
  toStatusId: 'in-review',
  memberId: 'member-1',
  promptTemplate: 'Review {{worktree}}.',
  enabled: true
}

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

describe('board automation IPC handlers', () => {
  let db: OrchestrationDb
  let settings: GlobalSettings
  let onWorkspaceStatusChanged: ReturnType<
    typeof vi.fn<BoardRuleEngine['onWorkspaceStatusChanged']>
  >

  beforeEach(() => {
    handlers.clear()
    db = new OrchestrationDb(':memory:')
    settings = { boardAutomation: { rules: [RULE] } } as GlobalSettings
    onWorkspaceStatusChanged = vi.fn<BoardRuleEngine['onWorkspaceStatusChanged']>()
    onWorkspaceStatusChanged.mockResolvedValue({ allow: true, dispatchId: 'ctx-1' })
    registerBoardAutomationHandlers({
      getOrchestrationDb: () => db,
      getSettings: () => settings,
      updateSettings: (updates) => {
        settings = { ...settings, ...updates } as GlobalSettings
      },
      engine: { onWorkspaceStatusChanged }
    })
  })

  describe('status', () => {
    it('reports the board state for a repo', async () => {
      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: 'repo-1' })).toMatchObject({
        killed: false
      })
    })

    // Why null rather than a default board: answering for an unnamed repo would show one board's
    // state on another's header.
    it('returns null without a repo id', async () => {
      expect(await invoke(BOARD_AUTOMATION_IPC.status, {})).toBeNull()
      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: '  ' })).toBeNull()
    })
  })

  describe('setKilled', () => {
    it('stops one board', async () => {
      await invoke(BOARD_AUTOMATION_IPC.setKilled, { repoId: 'repo-1', killed: true })

      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: 'repo-1' })).toMatchObject({
        killed: true,
        boardDisabledBy: 'ui'
      })
    })

    // Why global on a missing repo: it is the switch someone reaches for before knowing which
    // board is misbehaving.
    it('stops every board when no repo is named', async () => {
      await invoke(BOARD_AUTOMATION_IPC.setKilled, { killed: true })

      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: 'repo-2' })).toMatchObject({
        killed: true
      })
    })

    it('resumes by clearing the scope', async () => {
      await invoke(BOARD_AUTOMATION_IPC.setKilled, { repoId: 'repo-1', killed: true })
      await invoke(BOARD_AUTOMATION_IPC.setKilled, { repoId: 'repo-1', killed: false })

      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: 'repo-1' })).toMatchObject({
        killed: false
      })
    })

    // Why reject rather than coerce: a non-boolean here would be a renderer bug, and guessing
    // which way the switch was meant to go is worse than refusing.
    it('refuses a non-boolean killed flag', async () => {
      expect(await invoke(BOARD_AUTOMATION_IPC.setKilled, { repoId: 'repo-1' })).toEqual({
        ok: false
      })
      expect(await invoke(BOARD_AUTOMATION_IPC.status, { repoId: 'repo-1' })).toMatchObject({
        killed: false
      })
    })
  })

  describe('listRules', () => {
    it('filters to one repo', async () => {
      settings = {
        boardAutomation: { rules: [RULE, { ...RULE, id: 'rule-2', repoId: 'repo-2' }] }
      } as GlobalSettings

      expect(await invoke(BOARD_AUTOMATION_IPC.listRules, { repoId: 'repo-1' })).toEqual({
        rules: [RULE]
      })
    })

    it('returns every rule when no repo is named', async () => {
      const result = (await invoke(BOARD_AUTOMATION_IPC.listRules, {})) as { rules: unknown[] }
      expect(result.rules).toHaveLength(1)
    })

    it('reports no rules when none are configured', async () => {
      settings = {} as GlobalSettings
      expect(await invoke(BOARD_AUTOMATION_IPC.listRules, { repoId: 'repo-1' })).toEqual({
        rules: []
      })
    })
  })

  describe('saveRules', () => {
    // Why validate here and not trust the pane: these rules dispatch agents that cost money, and a
    // malformed one persisted once keeps failing later at dispatch time, where it is far less
    // visible than at the point of saving.
    it.each([
      ['a missing id', { ...RULE, id: '' }],
      ['a missing member', { ...RULE, memberId: '   ' }],
      ['a missing column', { ...RULE, toStatusId: '' }],
      ['a non-object rule', 'not-a-rule']
    ])('refuses %s and persists nothing', async (_label, bad) => {
      const result = await invoke(BOARD_AUTOMATION_IPC.saveRules, {
        repoId: 'repo-1',
        rules: [bad]
      })

      expect(result).toEqual({ ok: false })
      expect(settings.boardAutomation?.rules).toEqual([RULE])
    })

    it('refuses a rule belonging to another repo', async () => {
      const result = await invoke(BOARD_AUTOMATION_IPC.saveRules, {
        repoId: 'repo-1',
        rules: [{ ...RULE, repoId: 'repo-2' }]
      })

      expect(result).toEqual({ ok: false })
    })

    it('refuses a non-array payload', async () => {
      expect(
        await invoke(BOARD_AUTOMATION_IPC.saveRules, { repoId: 'repo-1', rules: 'nope' })
      ).toEqual({ ok: false })
    })

    // The claim this guards: two project settings panes open at once must not overwrite each
    // other's boards.
    it('replaces only the edited repo slice', async () => {
      const other: BoardAutomationRule = { ...RULE, id: 'rule-2', repoId: 'repo-2' }
      settings = { boardAutomation: { rules: [RULE, other] } } as GlobalSettings

      await invoke(BOARD_AUTOMATION_IPC.saveRules, {
        repoId: 'repo-1',
        rules: [{ ...RULE, memberId: 'member-changed' }]
      })

      const saved = settings.boardAutomation?.rules ?? []
      expect(saved).toContainEqual(other)
      expect(saved.find((rule) => rule.repoId === 'repo-1')?.memberId).toBe('member-changed')
      expect(saved).toHaveLength(2)
    })

    it('saves an empty list, which is how the last rule is removed', async () => {
      expect(
        await invoke(BOARD_AUTOMATION_IPC.saveRules, { repoId: 'repo-1', rules: [] })
      ).toMatchObject({ ok: true })
      expect(settings.boardAutomation?.rules).toEqual([])
    })

    // Why default true: a rule saved without the flag came from an older renderer, and the pane
    // always sends it. Only an explicit false disables.
    it('treats a missing enabled flag as enabled', async () => {
      const { enabled: _enabled, ...withoutFlag } = RULE
      await invoke(BOARD_AUTOMATION_IPC.saveRules, { repoId: 'repo-1', rules: [withoutFlag] })

      expect(settings.boardAutomation?.rules?.[0]?.enabled).toBe(true)
    })
  })

  describe('statusChanged', () => {
    const CHANGE = {
      worktreeId: 'wt-1',
      repoId: 'repo-1',
      fromStatusId: 'todo',
      toStatusId: 'in-review',
      worktreePath: '/tmp/wt-1'
    }

    it('hands the change to the engine and reports the dispatch', async () => {
      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({ dispatched: true })
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith(expect.objectContaining(CHANGE))
    })

    it.each([
      ['a missing worktree', { ...CHANGE, worktreeId: '' }],
      ['a missing repo', { ...CHANGE, repoId: '' }],
      ['a missing column', { ...CHANGE, toStatusId: '' }]
    ])('ignores %s', async (_label, bad) => {
      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, bad)).toEqual({ dispatched: false })
      expect(onWorkspaceStatusChanged).not.toHaveBeenCalled()
    })

    // Why swallow: this rides a board move. A rule that cannot dispatch must never make the card
    // fail to move, and the refusal is recorded where the switch shows it.
    it('swallows an engine failure rather than rejecting the move', async () => {
      onWorkspaceStatusChanged.mockRejectedValue(new Error('orchestration is gone'))

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: false
      })
    })

    // A code stage takes its own edge; main resolves which column that is, the renderer moves.
    it('passes a code stage\u2019s forward column back to the renderer', async () => {
      onWorkspaceStatusChanged.mockResolvedValue({
        allow: true,
        ranCode: { stageKey: 'format', exitCode: 0 },
        moveToStatusId: 'completed'
      })

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: true,
        moveToStatusId: 'completed'
      })
    })

    it('passes a correction column back even though nothing was dispatched', async () => {
      onWorkspaceStatusChanged.mockResolvedValue({
        allow: false,
        reason: 'code_failed',
        detail: 'tsc: 4 errors',
        moveToStatusId: 'in-progress'
      })

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: false,
        moveToStatusId: 'in-progress'
      })
    })

    // A gated stage moves nowhere: that is the whole point of the gate.
    it('reports a gated code stage with no move', async () => {
      onWorkspaceStatusChanged.mockResolvedValue({
        allow: false,
        reason: 'code_gated',
        detail: 'no correction edge',
        gateId: 'gate_1'
      })

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: false
      })
    })

    it('reports a refusal as not dispatched', async () => {
      onWorkspaceStatusChanged.mockResolvedValue({ allow: false, reason: 'ceiling', detail: 'x' })

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: false
      })
    })

    // The engine is absent in headless modes; the channel must then be inert rather than throw.
    it('does nothing without an engine', async () => {
      handlers.clear()
      registerBoardAutomationHandlers({
        getOrchestrationDb: () => db,
        getSettings: () => settings,
        updateSettings: () => {},
        engine: null
      })

      expect(await invoke(BOARD_AUTOMATION_IPC.statusChanged, CHANGE)).toEqual({
        dispatched: false
      })
    })
  })
})
