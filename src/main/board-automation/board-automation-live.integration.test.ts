// Live end-to-end oracle for board automation: a real SQLite orchestration database, a real
// Control API over real HTTP, the real workflow client and directory, the real guard rails and the
// real rule engine. Only `startWorkerForTask` is stubbed, because launching an agent needs an
// Electron runtime and real terminals — everything up to the launch is the genuine article.
//
// This exists because every defect this feature shipped was at a boundary the unit tests mocked:
// SQLite writing `datetime('now')` at second resolution and `Date.parse` reading it as local time,
// a SQL string comparison between two timestamp formats, and stage keys that share nothing with
// board column ids. All four passed a green unit suite and failed the moment real components met.
//
// Run it against the local stack:
//   cd cloud && pnpm alicorn:up && pnpm alicorn:seed
//   ALICORN_TEST_CONTROL_API_URL=http://127.0.0.1:8081 \
//   ALICORN_TEST_CONTROL_API_TOKEN=local-dev-token-change-me-0001 pnpm test board-automation-live
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { createControlPlaneClient } from '../alicorn/control-plane-client'
import { createWorkflowDirectory } from './workflow-directory'
import { createBoardRuleStore } from './board-rule-store'
import { createBoardRuleEngine } from './board-rule-engine'
import { BOARD_DISPATCH_CEILING } from './board-guard-rails'
import { setBoardAutomationKilled, boardKillScope } from './board-kill-switch'
import type { BoardAutomationRule } from '../../shared/global-settings-types'

const controlApiUrl = process.env.ALICORN_TEST_CONTROL_API_URL
const token = process.env.ALICORN_TEST_CONTROL_API_TOKEN ?? 'local-dev-token-change-me-0001'
const tenantId = process.env.ALICORN_TEST_CONTROL_API_TENANT ?? 'local'
const projectId = process.env.ALICORN_TEST_CONTROL_API_PROJECT ?? 'local'

const describeLive = controlApiUrl ? describe : describe.skip

const startWorkerForTask = vi.hoisted(() => vi.fn())
vi.mock('../runtime/rpc/methods/orchestration-worker-internal', () => ({ startWorkerForTask }))

// The engine only needs these two off the runtime; the rest of OrcaRuntimeService is irrelevant
// here because worker start is the stubbed boundary.
function runtimeStub(db: OrchestrationDb): never {
  return {
    getOrchestrationDb: () => db,
    getOrchestrationDispatchAuthority: () => null
  } as never
}

const EVENT = {
  worktreeId: 'wt-live-1',
  repoId: projectId,
  fromStatusId: 'todo',
  toStatusId: 'in-review',
  worktreePath: '/tmp/wt-live-1',
  issueRef: 'ALC-63',
  workspaceName: 'alc-63-live'
}

describeLive('board automation against a live control plane', () => {
  let db: OrchestrationDb

  beforeAll(() => {
    process.env.ALICORN_CONTROL_API_URL = controlApiUrl
    process.env.ALICORN_LEDGER_API_URL = controlApiUrl
    process.env.ALICORN_LOCAL_API_TOKEN = token
    process.env.ALICORN_TENANT_ID = tenantId
  })

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    startWorkerForTask.mockReset()
    startWorkerForTask.mockResolvedValue({ dispatchId: 'ctx-live-1', state: 'ready' })
  })

  afterEach(() => {
    db.close()
  })

  function engine(rules: BoardAutomationRule[] = []) {
    return createBoardRuleEngine({
      runtime: runtimeStub(db),
      getDb: () => db,
      rules: createBoardRuleStore(() => ({ boardAutomation: { rules } }) as never),
      workflows: createWorkflowDirectory(createControlPlaneClient())
    })
  }

  // The regression that shipped: stage keys are pipeline steps and column ids are board states, so
  // binding on `key` resolved every column to `no-stage`. Only real workflow data shows it.
  it('binds the seeded board columns to their stages', async () => {
    const directory = createWorkflowDirectory(createControlPlaneClient())

    const bound = await Promise.all(
      ['todo', 'in-progress', 'in-review', 'completed'].map(async (column) => {
        const binding = await directory.resolveColumn(projectId, column)
        return [column, binding.kind] as const
      })
    )

    expect(Object.fromEntries(bound)).toEqual({
      todo: 'stage',
      'in-progress': 'stage',
      'in-review': 'stage',
      completed: 'stage'
    })
  })

  it('carries the authored stage attributes through the real API', async () => {
    const directory = createWorkflowDirectory(createControlPlaneClient())

    const merge = await directory.resolveColumn(projectId, 'completed')
    const build = await directory.resolveColumn(projectId, 'in-progress')

    // Authored on the stage and never inferred (ARCHITECTURE §7); the autonomy policy reads these.
    expect(merge.kind === 'stage' && merge.stage.reversibility).toBe('irreversible')
    expect(build.kind === 'stage' && build.stage.reversibility).toBe('contained')
  })

  it('dispatches the stage member and records the transition under the stage key', async () => {
    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: true, dispatchId: 'ctx-live-1' })
    const [recorded] = db.listBoardTransitions(EVENT.worktreeId, 0)
    // `review`, not `in-review`: stage_key is the stage's, so member_stage_stats does not mix a
    // reviewer's record into implementation work.
    expect(recorded).toMatchObject({ outcome: 'dispatched', ruleId: 'review' })
    expect(startWorkerForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          worktree: `id:${EVENT.worktreeId}`,
          from: `board:${projectId}`
        })
      })
    )
  })

  // Both timestamp defects lived here: the ceiling counted nothing because rows written by SQLite
  // parsed as local time, and the window query excluded same-day rows entirely.
  it('enforces the dispatch ceiling against rows a real SQLite wrote', async () => {
    for (let i = 0; i < BOARD_DISPATCH_CEILING.max; i++) {
      db.recordBoardTransition({
        repoId: projectId,
        worktreeId: EVENT.worktreeId,
        toStatusId: `col-${i}`,
        ruleId: 'rule-live',
        outcome: 'dispatched'
      })
    }

    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'ceiling' })
    expect(startWorkerForTask).not.toHaveBeenCalled()
  })

  it('honours the kill switch over a live workflow', async () => {
    setBoardAutomationKilled(db, boardKillScope(projectId), 'integration')

    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'killed' })
    expect(startWorkerForTask).not.toHaveBeenCalled()
  })

  // A column the workflow does not stage must degrade to the rules rather than take automation
  // down — the mitigation from the shipped regression.
  it('falls back to a rule for a column no stage claims', async () => {
    const rule: BoardAutomationRule = {
      id: 'rule-archived',
      repoId: projectId,
      toStatusId: 'archived',
      memberId: 'member-from-rule',
      promptTemplate: 'Archive {{worktree}}.',
      enabled: true
    }

    const result = await engine([rule]).onWorkspaceStatusChanged({
      ...EVENT,
      toStatusId: 'archived'
    })

    expect(result).toMatchObject({ allow: true })
    expect(startWorkerForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ member: 'member-from-rule' })
      })
    )
  })

  // Fail closed: without the workflow we would be guessing at `reversibility`.
  it('refuses when the control plane is unreachable', async () => {
    process.env.ALICORN_CONTROL_API_URL = 'http://127.0.0.1:1'
    try {
      const result = await engine().onWorkspaceStatusChanged(EVENT)
      expect(result).toMatchObject({ allow: false, reason: 'workflow_unavailable' })
      expect(startWorkerForTask).not.toHaveBeenCalled()
    } finally {
      process.env.ALICORN_CONTROL_API_URL = controlApiUrl
    }
  })
})
