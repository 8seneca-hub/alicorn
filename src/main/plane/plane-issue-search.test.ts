import { describe, expect, it } from 'vitest'
import type { PlaneIssue, PlaneState, PlaneStateGroup } from '../../shared/plane-types'
import { filterPlaneIssues, resolveStateByName } from './plane-issue-search'

function state(id: string, name: string, group: PlaneStateGroup): PlaneState {
  return { id, name, color: '#000', group, isDefault: false }
}

const STATES = [
  state('s-todo', 'Todo', 'unstarted'),
  state('s-doing', 'In Progress', 'started'),
  state('s-review', 'In Review', 'started'),
  state('s-done', 'Done', 'completed')
]

function issue(readableId: string, name: string, stateId: string | null): PlaneIssue {
  return { readableId, name, stateId, sequenceId: 0 } as PlaneIssue
}

const ISSUES = [
  issue('ALC-1', 'Fix the auth bug', 's-todo'),
  issue('ALC-2', 'Ship the board', 's-doing'),
  issue('ALC-3', 'Review the auth flow', 's-review'),
  issue('ALC-4', 'Archived thing', null)
]

describe('filterPlaneIssues', () => {
  it('returns everything when nothing is asked for', () => {
    expect(filterPlaneIssues(ISSUES, STATES, {})).toHaveLength(4)
  })

  it('filters by state group rather than by the editable state name', () => {
    const started = filterPlaneIssues(ISSUES, STATES, { stateGroup: 'started' })
    expect(started.map((i) => i.readableId)).toEqual(['ALC-2', 'ALC-3'])
  })

  it('matches the query against the name and the readable id', () => {
    expect(filterPlaneIssues(ISSUES, STATES, { query: 'auth' }).map((i) => i.readableId)).toEqual([
      'ALC-1',
      'ALC-3'
    ])
    expect(filterPlaneIssues(ISSUES, STATES, { query: 'alc-2' }).map((i) => i.readableId)).toEqual([
      'ALC-2'
    ])
  })

  it('combines a group and a query rather than treating them as alternatives', () => {
    const result = filterPlaneIssues(ISSUES, STATES, { stateGroup: 'started', query: 'auth' })
    expect(result.map((i) => i.readableId)).toEqual(['ALC-3'])
  })

  // An issue with no state cannot belong to a group, and must not be swept in.
  it('excludes a stateless issue from any group filter', () => {
    const result = filterPlaneIssues(ISSUES, STATES, { stateGroup: 'unstarted' })
    expect(result.map((i) => i.readableId)).toEqual(['ALC-1'])
  })

  it('caps the result at the limit', () => {
    expect(filterPlaneIssues(ISSUES, STATES, { limit: 2 })).toHaveLength(2)
  })
})

describe('resolveStateByName', () => {
  it('resolves an exact name regardless of case and padding', () => {
    expect(resolveStateByName(STATES, '  in review ')).toEqual({ state: STATES[2] })
  })

  it('accepts a unique prefix', () => {
    expect(resolveStateByName(STATES, 'Don')).toEqual({ state: STATES[3] })
  })

  // Why: "In" prefixes two states, and picking one would move a real issue to a
  // state the caller did not name.
  it('returns the candidates for an ambiguous prefix instead of choosing', () => {
    const result = resolveStateByName(STATES, 'In')
    expect(result).toEqual({ candidates: [STATES[1], STATES[2]] })
  })

  it('returns no candidates when nothing matches', () => {
    expect(resolveStateByName(STATES, 'Blocked')).toEqual({ candidates: [] })
  })

  it('prefers an exact match over a longer state it prefixes', () => {
    const states = [...STATES, state('s-todo-2', 'Todo later', 'unstarted')]
    expect(resolveStateByName(states, 'Todo')).toEqual({ state: STATES[0] })
  })
})
