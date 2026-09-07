import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import { createWorkflowDirectory } from './workflow-directory'

const listWorkflows = vi.fn()
const getWorkflow = vi.fn()

const WORKFLOW = {
  id: 'wf-1',
  tenantId: 'local',
  projectId: 'repo-1',
  name: 'Feature delivery',
  version: 1,
  stages: [
    {
      key: 'review',
      name: 'Review',
      ordinal: 0,
      memberId: 'member-1',
      columnId: 'in-review',
      kind: 'worker' as const,
      codeCommand: null,
      reversibility: 'contained' as const,
      inheritedCost: 'low' as const,
      requiredChecks: []
    }
  ],
  transitions: [],
  createdBy: 'seed',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z'
}

function directory(now: () => number = () => 0) {
  return createWorkflowDirectory({ listWorkflows, getWorkflow } as unknown as ControlPlaneClient, {
    ttlMs: 1000,
    now
  })
}

describe('workflow directory', () => {
  beforeEach(() => {
    listWorkflows.mockReset()
    getWorkflow.mockReset()
    listWorkflows.mockResolvedValue([{ id: 'wf-1' }])
    getWorkflow.mockResolvedValue(WORKFLOW)
  })

  it('resolves a column to its stage', async () => {
    const binding = await directory().resolveColumn('repo-1', 'in-review')
    expect(binding).toMatchObject({ kind: 'stage' })
  })

  it('reports none for a project with no workflow', async () => {
    listWorkflows.mockResolvedValue([])
    expect(await directory().resolveColumn('repo-1', 'in-review')).toEqual({ kind: 'none' })
  })

  // Why not 'unavailable': no control plane configured is the pre-v1.5 shape, not a failed read,
  // and ad-hoc rules are the legitimate model there.
  it('reports none when no control plane is configured', async () => {
    const binding = await createWorkflowDirectory(null).resolveColumn('repo-1', 'in-review')
    expect(binding).toEqual({ kind: 'none' })
  })

  // Why this is the important one: dispatching on an unreadable workflow means guessing at
  // `reversibility`, which ARCHITECTURE §7 says is authored and never inferred.
  it('reports unavailable when the read fails', async () => {
    listWorkflows.mockRejectedValue(new Error('control_plane_unconfigured'))

    const binding = await directory().resolveColumn('repo-1', 'in-review')

    expect(binding).toMatchObject({ kind: 'unavailable' })
    expect(binding).toHaveProperty('detail', expect.stringContaining('control_plane'))
  })

  it('serves a cached workflow inside the TTL', async () => {
    const dir = directory(() => 0)
    await dir.resolveColumn('repo-1', 'in-review')
    await dir.resolveColumn('repo-1', 'in-review')

    expect(listWorkflows).toHaveBeenCalledTimes(1)
  })

  // Why the TTL is a hard edge here, unlike the member directory: a stale read decides whether a
  // stage is irreversible, so past the TTL an unreadable control plane must refuse rather than
  // serve last-known attributes that may since have gained a hard stop.
  it('refuses rather than serving a stale workflow once the TTL lapses', async () => {
    let now = 0
    const dir = directory(() => now)
    await dir.resolveColumn('repo-1', 'in-review')

    now = 5000
    listWorkflows.mockRejectedValue(new Error('offline'))

    expect(await dir.resolveColumn('repo-1', 'in-review')).toMatchObject({ kind: 'unavailable' })
  })

  it('caches per project', async () => {
    const dir = directory()
    await dir.resolveColumn('repo-1', 'in-review')
    await dir.resolveColumn('repo-2', 'in-review')

    expect(listWorkflows).toHaveBeenCalledTimes(2)
  })
})
