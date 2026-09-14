import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/alicorn/projects'
import type { Task } from '../../../shared/alicorn/tasks'
import { buildSearchableAlicornTasks, searchAlicornTasks } from './alicorn-task-palette-search'

const PROJECT: Project = {
  id: 'proj-1',
  tenantId: 'local',
  name: 'Alicorn',
  key: 'ALC',
  context: '',
  repoIds: [],
  source: null,
  createdBy: 'local',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

function makeTask(number: number, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${number}`,
    tenantId: 'local',
    projectId: PROJECT.id,
    number,
    title,
    context: '',
    column: 'todo',
    executionStrategy: 'single',
    workflowId: null,
    stageKey: null,
    skippedStageKeys: [],
    model: null,
    memberIds: [],
    source: null,
    createdBy: 'local',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: `2026-09-0${number}T00:00:00.000Z`,
    closedAt: null,
    ...overrides
  }
}

const TASKS = [
  makeTask(1, 'Wire the ledger outbox drainer'),
  makeTask(2, 'The palette searches tasks'),
  makeTask(3, 'Archive the old board', { column: 'completed' })
]

const entries = buildSearchableAlicornTasks([PROJECT], { [PROJECT.id]: TASKS })

function refs(query: string): string[] {
  return searchAlicornTasks(entries, query).map((result) => result.ref)
}

describe('searchAlicornTasks', () => {
  it('lists only open tasks on an empty query, most recently changed first', () => {
    expect(refs('')).toEqual(['ALC-2', 'ALC-1'])
  })

  it('finds a task by the reference a person says out loud', () => {
    expect(refs('ALC-2')).toEqual(['ALC-2'])
    expect(refs('alc-2')).toEqual(['ALC-2'])
  })

  it('matches title words in any order', () => {
    expect(refs('searches palette')).toEqual(['ALC-2'])
    expect(refs('palette searches')).toEqual(['ALC-2'])
  })

  it('still finds a completed task by name', () => {
    expect(refs('archive board')).toEqual(['ALC-3'])
  })

  it('ranges highlight the field the token landed on', () => {
    const [result] = searchAlicornTasks(entries, 'outbox')
    expect(result?.titleRanges.length).toBe(1)
    expect(result?.title.slice(result.titleRanges[0]!.start, result.titleRanges[0]!.end)).toBe(
      'outbox'
    )
  })

  it('returns nothing for a query no task carries', () => {
    expect(refs('kubernetes')).toEqual([])
  })
})
