import type { PlaneIssue, PlaneProject } from '../../shared/plane-types'

// A CLI caller names an issue the way it is written on the board — ALC-11 — or
// by the uuid the API addresses. Only the second is directly fetchable, so the
// readable form is parsed here and resolved against a project's issues.
export type PlaneIssueReference =
  | { kind: 'uuid'; issueId: string }
  | { kind: 'readable'; projectIdentifier: string; sequenceId: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Project identifiers are short alphanumeric keys; the sequence is the running
// number after the last dash, so a key containing a dash still parses.
const READABLE = /^([A-Za-z0-9][A-Za-z0-9_]*)-(\d+)$/

export function parsePlaneIssueReference(input: string): PlaneIssueReference | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  if (UUID.test(trimmed)) {
    return { kind: 'uuid', issueId: trimmed }
  }
  const match = READABLE.exec(trimmed)
  if (!match) {
    return null
  }
  const sequenceId = Number(match[2])
  return Number.isSafeInteger(sequenceId)
    ? { kind: 'readable', projectIdentifier: match[1].toUpperCase(), sequenceId }
    : null
}

export function findProjectByIdentifier(
  projects: readonly PlaneProject[],
  identifier: string
): PlaneProject | null {
  const wanted = identifier.trim().toUpperCase()
  return projects.find((project) => project.identifier.toUpperCase() === wanted) ?? null
}

export function findIssueBySequence(
  issues: readonly PlaneIssue[],
  sequenceId: number
): PlaneIssue | null {
  return issues.find((issue) => issue.sequenceId === sequenceId) ?? null
}
