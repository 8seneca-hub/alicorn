import { describe, expect, it } from 'vitest'
import type { Workflow, WorkflowStage } from '../../shared/alicorn/workflows'
import { bindColumnToStage, selectProjectWorkflow } from './workflow-stage-binding'

function stage(key: string, over: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    key,
    name: key,
    ordinal: 0,
    memberId: 'member-1',
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
  // Why by key: a stage keyed `in-review` *is* the In review column. That is the "one model, two
  // views" claim, and why WF1 made the wire address stages by key rather than by id.
  it('binds a column to the stage sharing its key', () => {
    const binding = bindColumnToStage(workflow([stage('build'), stage('in-review')]), 'in-review')

    expect(binding).toMatchObject({ kind: 'stage', workflowId: 'wf-1', workflowVersion: 3 })
    expect(binding.kind === 'stage' && binding.stage.key).toBe('in-review')
  })

  // Why distinct from 'none': a workflow that deliberately does not stage a column means nothing
  // happens there, which is different from a project that has no workflow at all.
  it('reports no-stage for a column the workflow does not cover', () => {
    const binding = bindColumnToStage(workflow([stage('build')]), 'in-review')

    expect(binding).toMatchObject({ kind: 'no-stage', workflowId: 'wf-1' })
  })

  it('carries the stage attributes the autonomy policy reads', () => {
    const binding = bindColumnToStage(
      workflow([stage('merge', { reversibility: 'irreversible', inheritedCost: 'high' })]),
      'merge'
    )

    expect(binding.kind === 'stage' && binding.stage).toMatchObject({
      reversibility: 'irreversible',
      inheritedCost: 'high'
    })
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
