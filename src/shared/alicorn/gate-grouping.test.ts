import { describe, expect, it } from 'vitest'
import type { PendingGateView } from './gate-review'
import { groupGatesByRepo } from './gate-grouping'

function gate(id: string, repoId: string | null): PendingGateView {
  return {
    id,
    taskId: `task-${id}`,
    taskTitle: null,
    question: 'Merge?',
    options: ['yes'],
    createdAt: '2026-09-11T00:00:00.000Z',
    recommendation: null,
    policyEvaluated: false,
    autonomyLevel: null,
    repoId
  }
}

const NAMES: Record<string, string> = { 'repo-z': 'Alpha', 'repo-a': 'Zulu' }
const repoName = (id: string): string => NAMES[id] ?? id

describe('groupGatesByRepo', () => {
  it("collects one repository's gates into one group", () => {
    const groups = groupGatesByRepo([gate('1', 'repo-a'), gate('2', 'repo-a')], repoName)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.gates.map((g) => g.id)).toEqual(['1', '2'])
  })

  // Sorted on the displayed name, not the id, so the queue reads like the sidebar looks.
  it('orders groups by the name a human sees, not by the id', () => {
    const groups = groupGatesByRepo([gate('1', 'repo-a'), gate('2', 'repo-z')], repoName)
    expect(groups.map((g) => g.repoId)).toEqual(['repo-z', 'repo-a'])
  })

  // The least actionable thing in the queue must not lead it.
  it('puts unattributed gates last', () => {
    const groups = groupGatesByRepo([gate('1', null), gate('2', 'repo-a')], repoName)
    expect(groups.map((g) => g.repoId)).toEqual(['repo-a', null])
  })

  it('omits the unattributed group when everything is placed', () => {
    const groups = groupGatesByRepo([gate('1', 'repo-a')], repoName)
    expect(groups.map((g) => g.repoId)).toEqual(['repo-a'])
  })

  it('returns nothing for an empty queue', () => {
    expect(groupGatesByRepo([], repoName)).toEqual([])
  })
})
