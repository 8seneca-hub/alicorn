/**
 * Searching the board from Cmd+J.
 *
 * A task is the unit of work, so it is the first thing the palette has to be able to find — by its
 * reference (`ALC-2`), by words from its title, in any order. It reuses the shared palette matcher
 * rather than a private substring pass so a task row ranks against tabs and actions on the same
 * scale.
 */
import { TASK_DONE_COLUMN, taskRef, type Task } from '../../../shared/alicorn/tasks'
import type { Project } from '../../../shared/alicorn/projects'
import { matchPaletteDocument } from './palette-match/match-document'
import { preparePaletteQuery } from './palette-match/palette-query'
import {
  buildPaletteDocument,
  comparePaletteDocumentRank,
  type PaletteDocument,
  type PaletteDocumentRank
} from './palette-match/palette-document'
import type { MatchRange } from './palette-match/normalized-text'
import type { PaletteResultQualityClass } from './palette-match/match-quality'

export const ALICORN_TASK_REF_FIELD_ID = 'ref'
export const ALICORN_TASK_TITLE_FIELD_ID = 'title'
export const ALICORN_TASK_PROJECT_FIELD_ID = 'project'

const NO_RANGES: readonly MatchRange[] = []

export type SearchableAlicornTask = {
  taskId: string
  projectId: string
  projectName: string
  /** `ALC-2` — what a person calls the ticket. */
  ref: string
  title: string
  column: string
  isOpen: boolean
  /** Board-change time, the only recency the control plane stores for a task. */
  updatedAt: string
  /** Normalized field index, built once per task rather than per keystroke. */
  document: PaletteDocument
}

export type AlicornTaskPaletteSearchResult = {
  taskId: string
  projectId: string
  projectName: string
  ref: string
  title: string
  column: string
  isOpen: boolean
  refRanges: readonly MatchRange[]
  titleRanges: readonly MatchRange[]
  projectRanges: readonly MatchRange[]
  qualityClass: PaletteResultQualityClass | null
  rank: PaletteDocumentRank | null
}

function buildAlicornTaskDocument(input: {
  taskId: string
  ref: string
  title: string
  projectName: string
}): PaletteDocument {
  return buildPaletteDocument({
    id: input.taskId,
    visibleFields: [
      {
        id: ALICORN_TASK_REF_FIELD_ID,
        profile: 'identifier',
        text: input.ref,
        identifier: { kind: 'key' }
      },
      { id: ALICORN_TASK_TITLE_FIELD_ID, profile: 'structured-label', text: input.title },
      // The project is where the task lives, not what it is: matching it alone demotes the row.
      {
        id: ALICORN_TASK_PROJECT_FIELD_ID,
        profile: 'structured-label',
        text: input.projectName,
        isContainer: true
      }
    ],
    evidence: []
  })
}

export function buildSearchableAlicornTasks(
  projects: readonly Project[],
  tasksByProject: Readonly<Record<string, readonly Task[] | undefined>>
): SearchableAlicornTask[] {
  const entries: SearchableAlicornTask[] = []
  for (const project of projects) {
    for (const task of tasksByProject[project.id] ?? []) {
      const ref = taskRef(project.key, task.number)
      entries.push({
        taskId: task.id,
        projectId: project.id,
        projectName: project.name,
        ref,
        title: task.title,
        column: task.column,
        isOpen: task.column !== TASK_DONE_COLUMN,
        updatedAt: task.updatedAt,
        document: buildAlicornTaskDocument({
          taskId: task.id,
          ref,
          title: task.title,
          projectName: project.name
        })
      })
    }
  }
  return entries
}

function toResult(
  entry: SearchableAlicornTask,
  match: {
    qualityClass: PaletteResultQualityClass
    rank: PaletteDocumentRank
    rangesByField: ReadonlyMap<string, readonly MatchRange[]>
  } | null
): AlicornTaskPaletteSearchResult {
  return {
    taskId: entry.taskId,
    projectId: entry.projectId,
    projectName: entry.projectName,
    ref: entry.ref,
    title: entry.title,
    column: entry.column,
    isOpen: entry.isOpen,
    refRanges: match?.rangesByField.get(ALICORN_TASK_REF_FIELD_ID) ?? NO_RANGES,
    titleRanges: match?.rangesByField.get(ALICORN_TASK_TITLE_FIELD_ID) ?? NO_RANGES,
    projectRanges: match?.rangesByField.get(ALICORN_TASK_PROJECT_FIELD_ID) ?? NO_RANGES,
    qualityClass: match?.qualityClass ?? null,
    rank: match?.rank ?? null
  }
}

/** Most recently changed first — the only recency a task carries. Done tasks sink. */
function compareUnqueried(a: SearchableAlicornTask, b: SearchableAlicornTask): number {
  if (a.isOpen !== b.isOpen) {
    return a.isOpen ? -1 : 1
  }
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt < b.updatedAt ? 1 : -1
  }
  return a.taskId.localeCompare(b.taskId)
}

export function searchAlicornTasks(
  entries: readonly SearchableAlicornTask[],
  query: string
): AlicornTaskPaletteSearchResult[] {
  const prepared = preparePaletteQuery(query)
  if (prepared.state === 'invalid') {
    return []
  }
  if (prepared.state === 'empty') {
    // The untyped list is open work — a finished ticket is still findable by name, but it is not
    // something to hand someone when they have said nothing.
    return entries
      .filter((entry) => entry.isOpen)
      .sort(compareUnqueried)
      .map((entry) => toResult(entry, null))
  }
  const matched: { entry: SearchableAlicornTask; result: AlicornTaskPaletteSearchResult }[] = []
  for (const entry of entries) {
    const match = matchPaletteDocument({
      document: entry.document,
      tokens: prepared.tokens,
      normalizedQuery: prepared.normalized
    })
    if (match) {
      matched.push({ entry, result: toResult(entry, match) })
    }
  }
  matched.sort((left, right) => {
    const byRank = comparePaletteDocumentRank(left.result.rank!, right.result.rank!)
    return byRank !== 0 ? byRank : compareUnqueried(left.entry, right.entry)
  })
  return matched.map(({ result }) => result)
}
