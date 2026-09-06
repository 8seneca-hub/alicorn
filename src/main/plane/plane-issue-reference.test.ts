import { describe, expect, it } from 'vitest'
import type { PlaneIssue, PlaneProject } from '../../shared/plane-types'
import {
  findIssueBySequence,
  findProjectByIdentifier,
  parsePlaneIssueReference
} from './plane-issue-reference'

describe('parsePlaneIssueReference', () => {
  it('reads a readable id the way it appears on the board', () => {
    expect(parsePlaneIssueReference('ALC-11')).toEqual({
      kind: 'readable',
      projectIdentifier: 'ALC',
      sequenceId: 11
    })
  })

  it('upper-cases the project key so a typed lowercase id still resolves', () => {
    expect(parsePlaneIssueReference('alc-11')).toMatchObject({ projectIdentifier: 'ALC' })
  })

  it('reads a uuid as the id the API addresses directly', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect(parsePlaneIssueReference(id)).toEqual({ kind: 'uuid', issueId: id })
  })

  it('splits on the last dash so a key containing one still parses', () => {
    expect(parsePlaneIssueReference('WEB_APP-42')).toMatchObject({
      projectIdentifier: 'WEB_APP',
      sequenceId: 42
    })
  })

  it('rejects input that names no issue', () => {
    for (const input of ['', '   ', 'ALC', '-11', 'ALC-', 'ALC-x']) {
      expect(parsePlaneIssueReference(input)).toBeNull()
    }
  })

  it('tolerates surrounding whitespace from a shell paste', () => {
    expect(parsePlaneIssueReference('  ALC-11 ')).toMatchObject({ sequenceId: 11 })
  })
})

describe('findProjectByIdentifier', () => {
  const projects = [
    { id: 'p1', identifier: 'ALC', name: 'Alicorn' },
    { id: 'p2', identifier: 'WEB', name: 'Web' }
  ] as PlaneProject[]

  it('matches a project key regardless of case', () => {
    expect(findProjectByIdentifier(projects, 'alc')?.id).toBe('p1')
  })

  it('returns null rather than guessing a project', () => {
    expect(findProjectByIdentifier(projects, 'NOPE')).toBeNull()
  })
})

describe('findIssueBySequence', () => {
  const issues = [{ sequenceId: 11 }, { sequenceId: 12 }] as PlaneIssue[]

  it('finds the issue carrying that running number', () => {
    expect(findIssueBySequence(issues, 12)?.sequenceId).toBe(12)
  })

  it('returns null for a sequence the project does not have', () => {
    expect(findIssueBySequence(issues, 99)).toBeNull()
  })
})
