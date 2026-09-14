import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorAutonomyStarterSet } from './author-autonomy-starter-set'
import type { AutonomyPolicy } from '../../../../../shared/alicorn/gate-policy'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'

function stage(
  over: Partial<WorkflowStage> & Pick<WorkflowStage, 'key' | 'ordinal'>
): WorkflowStage {
  return {
    name: over.key,
    memberId: null,
    columnId: null,
    kind: 'worker',
    codeCommand: null,
    reversibility: 'contained',
    inheritedCost: 'low',
    requiredChecks: [],
    ...over
  }
}

type Written = { projectId: string; policy: { stageKey: string; mode: string } }

function withBridge(fail?: string): Written[] {
  const written: Written[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      alicorn: {
        setAutonomyPolicy: vi.fn(
          (projectId: string, policy: { stageKey: string; mode: string }) => {
            if (fail === policy.stageKey) {
              return Promise.resolve({ ok: false, error: 'forbidden' })
            }
            written.push({ projectId, policy })
            return Promise.resolve({ ok: true, policy })
          }
        )
      }
    }
  }
  return written
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

const STAGES = [
  stage({ key: 'spec', ordinal: 0 }),
  stage({ key: 'architecture', ordinal: 1, inheritedCost: 'high' }),
  stage({ key: 'merge', ordinal: 2, reversibility: 'irreversible' })
]

describe('authoring a workflow’s first autonomy policies', () => {
  it('gates the hard stops outright and puts the rest on evidence', async () => {
    const written = withBridge()
    expect(await authorAutonomyStarterSet({ projectId: 'prj_1', stages: STAGES })).toEqual({
      ok: true,
      written: 3
    })
    expect(written.map((row) => [row.policy.stageKey, row.policy.mode])).toEqual([
      ['spec', 'evidence'],
      // Cheap to write, expensive to be wrong about — and a merge is a production deploy.
      ['architecture', 'always_gate'],
      ['merge', 'always_gate']
    ])
  })

  // Someone who has tuned a level is not asking for the starter value back.
  it('never writes over a stage that is already authored', async () => {
    const written = withBridge()
    const existing = [{ stageKey: 'spec' } as AutonomyPolicy]
    expect(
      await authorAutonomyStarterSet({ projectId: 'prj_1', stages: STAGES, existing })
    ).toEqual({ ok: true, written: 2 })
    expect(written.map((row) => row.policy.stageKey)).toEqual(['architecture', 'merge'])
  })

  // A partially authored project still gates everywhere it was not reached, which is the safe way
  // to fail — so the refusal is reported rather than rolled back.
  it('reports a refused write and stops there', async () => {
    const written = withBridge('architecture')
    expect(await authorAutonomyStarterSet({ projectId: 'prj_1', stages: STAGES })).toEqual({
      ok: false,
      error: 'forbidden'
    })
    expect(written.map((row) => row.policy.stageKey)).toEqual(['spec'])
  })
})
