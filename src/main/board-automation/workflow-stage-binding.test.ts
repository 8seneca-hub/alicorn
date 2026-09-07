import { describe, expect, it } from 'vitest'
import type { Workflow, WorkflowStage } from '../../shared/alicorn/workflows'
import { bindColumnToStage, selectProjectWorkflow } from './workflow-stage-binding'

function stage(key: string, over: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    key,
    name: key,
    ordinal: 0,
    memberId: 'member-1',
    columnId: key,
    reversibility: 'contained',
    inheritedCost: 'low',
    requiredChecks: [],
    ...over
  }
}

function workflow(stages: WorkflowStage[]): Workflow {
  return {
    id: 'wf-1',
    tenantId: 'local',
    projectId: 'repo-1',
    name: 'Feature delivery',
    version: 3,
    stages,
    transitions: [],
    createdBy: 'seed',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z'
  }
}

describe('bindColumnToStage', () => {
  // Why on columnId and not key: the two vocabularies are different granularities — eight pipeline
  // stages against four board columns — and verified against the seeded stack the key sets share
  // nothing (decision 11).
  it('binds a column to the stage naming it', () => {
    const binding = bindColumnToStage(
      workflow([
        stage('build', { columnId: 'in-progress' }),
        stage('review', { columnId: 'in-review' })
      ]),
      'in-review'
    )

    expect(binding).toMatchObject({ kind: 'stage', workflowId: 'wf-1', workflowVersion: 3 })
    expect(binding.kind === 'stage' && binding.stage.key).toBe('review')
  })

  // Why distinct from 'none': a workflow that deliberately does not stage a column means nothing
  // happens there, which is different from a project that has no workflow at all.
  it('reports no-stage for a column the workflow does not cover', () => {
    const binding = bindColumnToStage(
      workflow([stage('build', { columnId: 'in-progress' })]),
      'in-review'
    )

    expect(binding).toMatchObject({ kind: 'no-stage', workflowId: 'wf-1' })
  })

  it('carries the stage attributes the autonomy policy reads', () => {
    const binding = bindColumnToStage(
      workflow([
        stage('merge', {
          columnId: 'completed',
          reversibility: 'irreversible',
          inheritedCost: 'high'
        })
      ]),
      'completed'
    )

    expect(binding.kind === 'stage' && binding.stage).toMatchObject({
      reversibility: 'irreversible',
      inheritedCost: 'high'
    })
  })
})

describe('bindColumnToStage — unbound stages', () => {
  // Why: a stage no column dispatches (Architecture, Design, Deploy in the shipped template) must
  // never be picked up by a board move, however its key is spelled.
  it('never binds a stage with no column', () => {
    const binding = bindColumnToStage(
      workflow([stage('architecture', { columnId: null })]),
      'architecture'
    )
    expect(binding.kind).toBe('no-stage')
  })

  // Several stages behind one column is the case columnId exists for; the unique index in the
  // schema keeps it from being ambiguous.
  it('binds the one stage naming the column when others share a key prefix', () => {
    const binding = bindColumnToStage(
      workflow([
        stage('build', { columnId: 'in-progress' }),
        stage('verify', { columnId: null }),
        stage('review', { columnId: 'in-review' })
      ]),
      'in-progress'
    )
    expect(binding.kind === 'stage' && binding.stage.key).toBe('build')
  })
})

describe('selectProjectWorkflow', () => {
  it('takes the first workflow for a project', () => {
    expect(selectProjectWorkflow([{ id: 'a' }, { id: 'b' }])).toEqual({ id: 'a' })
  })

  it('reports none when the project has no workflow', () => {
    expect(selectProjectWorkflow([])).toBeNull()
  })
})
