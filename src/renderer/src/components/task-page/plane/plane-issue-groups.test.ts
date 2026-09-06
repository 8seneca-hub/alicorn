import { describe, expect, it } from 'vitest'
import { filterPlaneIssues, groupPlaneIssuesByState } from './plane-issue-groups'
import type { PlaneIssue, PlaneState, PlaneStateGroup } from '../../../../../shared/plane-types'

function state(id: string, name: string, group: PlaneStateGroup): PlaneState {
  return { id, name, color: '#000', group, isDefault: false }
}

function issue(id: string, stateId: string | null, name = id): PlaneIssue {
  return {
    id,
    sequenceId: 1,
    readableId: `ALC-${id}`,
    name,
    descriptionHtml: '',
    priority: 'none',
    stateId,
    projectId: 'p1',
    assigneeIds: [],
    labelIds: [],
    parentId: null,
    startDate: null,
    targetDate: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    completedAt: null,
    isDraft: false
  }
}

describe('groupPlaneIssuesByState', () => {
  it('orders groups by state group, not by state name', () => {
    const states = [
      state('s-done', 'Done', 'completed'),
      state('s-todo', 'Todo', 'unstarted'),
      state('s-doing', 'In Progress', 'started'),
      state('s-back', 'Backlog', 'backlog')
    ]
    const issues = [
      issue('1', 's-done'),
      issue('2', 's-todo'),
      issue('3', 's-doing'),
      issue('4', 's-back')
    ]

    expect(groupPlaneIssuesByState(issues, states).map((group) => group.state.group)).toEqual([
      'backlog',
      'unstarted',
      'started',
      'completed'
    ])
  })

  it('drops empty states so the list is not mostly headers', () => {
    const states = [state('s1', 'Todo', 'unstarted'), state('s2', 'Done', 'completed')]

    const groups = groupPlaneIssuesByState([issue('1', 's1')], states)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.state.id).toBe('s1')
  })

  it('drops an issue whose state the project does not list', () => {
    // Plane excludes triage states from the states endpoint, so an unmatched
    // state means the issue is not one this view is meant to show.
    expect(
      groupPlaneIssuesByState([issue('1', 's-triage')], [state('s1', 'Todo', 'unstarted')])
    ).toEqual([])
  })

  it('drops an issue with no state at all', () => {
    expect(groupPlaneIssuesByState([issue('1', null)], [state('s1', 'Todo', 'unstarted')])).toEqual(
      []
    )
  })

  it('keeps every issue in its own state bucket', () => {
    const states = [state('s1', 'Todo', 'unstarted')]
    const groups = groupPlaneIssuesByState([issue('1', 's1'), issue('2', 's1')], states)

    expect(groups[0]?.issues.map((entry) => entry.id)).toEqual(['1', '2'])
  })
})

describe('filterPlaneIssues', () => {
  it('returns everything for a blank query', () => {
    const issues = [issue('1', 's1'), issue('2', 's1')]
    expect(filterPlaneIssues(issues, '   ')).toHaveLength(2)
  })

  it('matches the title case-insensitively', () => {
    const issues = [issue('1', 's1', 'Fix the drainer'), issue('2', 's1', 'Add a badge')]
    expect(filterPlaneIssues(issues, 'DRAINER').map((entry) => entry.id)).toEqual(['1'])
  })

  it('matches the readable id, which is how people refer to an issue', () => {
    const issues = [issue('11', 's1'), issue('12', 's1')]
    expect(filterPlaneIssues(issues, 'alc-11').map((entry) => entry.id)).toEqual(['11'])
  })

  it('does not mutate the input', () => {
    const issues = [issue('1', 's1')]
    expect(filterPlaneIssues(issues, '')).not.toBe(issues)
  })
})
