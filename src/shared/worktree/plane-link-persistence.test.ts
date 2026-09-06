import { describe, expect, it } from 'vitest'
import { WORKTREE_META_PERSISTED_DEFAULTS } from './meta-persisted-defaults'
import type { WorktreeMeta } from './meta-types'
import type { Worktree } from './types'

// Plane needs four fields where the other providers need one: the uuid is what
// the API addresses, the sequence is what a human reads, and the slug plus
// project id are both required to build a URL back to the issue.
const PLANE_LINK_FIELDS = [
  'linkedPlaneIssue',
  'linkedPlaneIssueSequence',
  'linkedPlaneWorkspaceSlug',
  'linkedPlaneProjectId'
] as const

describe('Plane worktree link persistence', () => {
  it('defaults every Plane link field to null', () => {
    for (const field of PLANE_LINK_FIELDS) {
      expect(WORKTREE_META_PERSISTED_DEFAULTS).toHaveProperty(field, null)
    }
  })

  it('round-trips a linked issue through the persisted meta shape', () => {
    const meta: WorktreeMeta = {
      ...WORKTREE_META_PERSISTED_DEFAULTS,
      linkedPlaneIssue: 'e162c28a-9393-4648-a896-74f746038a9e',
      linkedPlaneIssueSequence: 11,
      linkedPlaneWorkspaceSlug: '8seneca',
      linkedPlaneProjectId: '2a53f690-4738-4491-b803-bbdf0a6e0cda'
    } as WorktreeMeta

    const restored = JSON.parse(JSON.stringify(meta)) as WorktreeMeta

    expect(restored.linkedPlaneIssue).toBe('e162c28a-9393-4648-a896-74f746038a9e')
    expect(restored.linkedPlaneIssueSequence).toBe(11)
    expect(restored.linkedPlaneWorkspaceSlug).toBe('8seneca')
    expect(restored.linkedPlaneProjectId).toBe('2a53f690-4738-4491-b803-bbdf0a6e0cda')
  })

  it('loads a worktree persisted before Plane existed', () => {
    // Every field is optional so an older persisted worktree keeps loading
    // without a migration — the same contract linkedGitLabIssue documents.
    const legacy = { id: 'w1', linkedIssue: null } as unknown as Worktree

    expect(legacy.linkedPlaneIssue).toBeUndefined()
    expect(legacy.linkedPlaneProjectId).toBeUndefined()
  })

  it('keeps the readable id separate from the addressable one', () => {
    // ALC-11 is what a person recognises; the uuid is what the API takes. A
    // single field would force one of the two to be reconstructed by guesswork.
    const meta = {
      ...WORKTREE_META_PERSISTED_DEFAULTS,
      linkedPlaneIssue: 'uuid-1',
      linkedPlaneIssueSequence: 11
    } as WorktreeMeta

    expect(meta.linkedPlaneIssue).not.toBe(String(meta.linkedPlaneIssueSequence))
  })
})
