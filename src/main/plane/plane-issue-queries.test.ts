import { describe, expect, it, vi } from 'vitest'
import { issueWebUrl, mapPlaneIssue } from './plane-issue-queries'
import type { PlaneClient } from './plane-request'

vi.mock('../network/http-client', () => ({ getMainHttpClient: () => ({}) }))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: async () => {} }))
vi.mock('../observability/tracer', () => ({
  withSpan: async (_name: string, run: (span: unknown) => unknown) =>
    run({ setAttribute: () => {}, addEvent: () => {} })
}))

const client: PlaneClient = {
  connectionId: '8seneca@https://projects.example.com',
  baseUrl: 'https://projects.example.com',
  workspaceSlug: '8seneca',
  apiKey: 'key'
}

describe('mapPlaneIssue', () => {
  it('maps a detail-shaped issue with bare relation ids', () => {
    const issue = mapPlaneIssue(
      {
        id: 'issue-1',
        name: 'B1 — env config',
        description_html: '<p>Goal</p>',
        priority: 'high',
        state: 'state-1',
        project: 'project-1',
        parent: null,
        sequence_id: 11,
        assignees: ['user-1', 'user-2'],
        labels: ['label-1'],
        start_date: null,
        target_date: '2026-09-30',
        created_at: '2026-09-06T07:15:27Z',
        updated_at: '2026-09-06T08:27:59Z',
        completed_at: null,
        is_draft: false
      },
      client,
      'ALC'
    )

    expect(issue).toEqual({
      id: 'issue-1',
      sequenceId: 11,
      readableId: 'ALC-11',
      name: 'B1 — env config',
      descriptionHtml: '<p>Goal</p>',
      priority: 'high',
      stateId: 'state-1',
      projectId: 'project-1',
      assigneeIds: ['user-1', 'user-2'],
      labelIds: ['label-1'],
      parentId: null,
      startDate: null,
      targetDate: '2026-09-30',
      createdAt: '2026-09-06T07:15:27Z',
      updatedAt: '2026-09-06T08:27:59Z',
      completedAt: null,
      isDraft: false,
      connectionId: client.connectionId,
      webUrl: 'https://projects.example.com/8seneca/projects/project-1/issues/issue-1'
    })
  })

  it('reads list-shaped relations that arrive as objects', () => {
    const issue = mapPlaneIssue(
      {
        id: 'issue-2',
        name: 'A8',
        project: { id: 'project-1' },
        state: { id: 'state-2', name: 'In Progress' },
        priority: { id: 'urgent', label: null },
        sequence_id: 8,
        created_at: '2026-09-06T07:15:25Z'
      },
      client,
      'ALC'
    )

    expect(issue?.stateId).toBe('state-2')
    expect(issue?.projectId).toBe('project-1')
    expect(issue?.priority).toBe('urgent')
  })

  it('falls back to none for an unknown priority', () => {
    const issue = mapPlaneIssue(
      { id: 'i', name: 'n', project: 'p', priority: 'blocker', created_at: 'x' },
      client
    )
    expect(issue?.priority).toBe('none')
  })

  it('uses the bare sequence when the project identifier is unknown', () => {
    const issue = mapPlaneIssue(
      { id: 'i', name: 'n', project: 'p', sequence_id: 42, created_at: 'x' },
      client
    )
    expect(issue?.readableId).toBe('42')
  })

  it('never invents timestamps', () => {
    const issue = mapPlaneIssue({ id: 'i', name: 'n', project: 'p' }, client)
    expect(issue?.createdAt).toBe('')
    expect(issue?.updatedAt).toBe('')
  })

  it('mirrors created_at into updated_at when only one is present', () => {
    const issue = mapPlaneIssue(
      { id: 'i', name: 'n', project: 'p', created_at: '2026-09-06T07:00:00Z' },
      client
    )
    expect(issue?.updatedAt).toBe('2026-09-06T07:00:00Z')
  })

  it('drops records missing identity', () => {
    expect(mapPlaneIssue({ name: 'no id', project: 'p' }, client)).toBeNull()
    expect(mapPlaneIssue({ id: 'i', project: 'p' }, client)).toBeNull()
    expect(mapPlaneIssue({ id: 'i', name: 'n' }, client)).toBeNull()
  })
})

describe('issueWebUrl', () => {
  it('builds the deep link the Plane UI uses', () => {
    expect(issueWebUrl('https://projects.example.com', 'ws', 'proj', 'iss')).toBe(
      'https://projects.example.com/ws/projects/proj/issues/iss'
    )
  })
})
