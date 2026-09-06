import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneIssue, PlaneProject } from '../../shared/plane-types'
import { PlaneIssueNotFoundError, resolvePlaneIssue } from './plane-issue-resolver'
import type { PlaneClient } from './plane-request'

const listProjects = vi.fn()
const listProjectIssues = vi.fn()
const getProjectIssue = vi.fn()

vi.mock('./plane-project-queries', () => ({
  listProjects: (...args: unknown[]) => listProjects(...args)
}))
vi.mock('./plane-issue-queries', () => ({
  listProjectIssues: (...args: unknown[]) => listProjectIssues(...args),
  getProjectIssue: (...args: unknown[]) => getProjectIssue(...args)
}))

const client = { connectionId: 'c', baseUrl: 'b', workspaceSlug: 'w', apiKey: 'k' } as PlaneClient
const project = { id: 'p1', identifier: 'ALC', name: 'Alicorn' } as PlaneProject
const issue = { id: 'i1', sequenceId: 11, readableId: 'ALC-11' } as PlaneIssue

beforeEach(() => {
  listProjects.mockReset()
  listProjectIssues.mockReset()
  getProjectIssue.mockReset()
})

describe('resolvePlaneIssue', () => {
  it('resolves a readable id through the project that owns the key', async () => {
    listProjects.mockResolvedValue([project])
    listProjectIssues.mockResolvedValue([issue])

    await expect(resolvePlaneIssue(client, 'ALC-11')).resolves.toEqual({ issue, project })
    expect(listProjectIssues).toHaveBeenCalledWith(client, 'p1', { projectIdentifier: 'ALC' })
  })

  it('rejects input that names no issue', async () => {
    await expect(resolvePlaneIssue(client, 'nonsense')).rejects.toThrow(PlaneIssueNotFoundError)
  })

  // Why: Plane's detail route is project-scoped, so a bare uuid is unresolvable
  // without one — better to say so than to scan every project.
  it('requires a project for a bare uuid', async () => {
    await expect(resolvePlaneIssue(client, '3f2504e0-4f89-11d3-9a0c-0305e82c3301')).rejects.toThrow(
      'needs --project'
    )
  })

  it('fetches a uuid directly when the project is given', async () => {
    getProjectIssue.mockResolvedValue(issue)
    const result = await resolvePlaneIssue(client, '3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
      projectId: 'p1'
    })
    expect(result.issue).toBe(issue)
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('lists the known project keys when the key is wrong', async () => {
    listProjects.mockResolvedValue([project, { identifier: 'WEB' } as PlaneProject])
    await expect(resolvePlaneIssue(client, 'NOPE-1')).rejects.toThrow('Known keys: ALC, WEB.')
  })

  it('names the project when the sequence is missing from it', async () => {
    listProjects.mockResolvedValue([project])
    listProjectIssues.mockResolvedValue([issue])
    await expect(resolvePlaneIssue(client, 'ALC-99')).rejects.toThrow('No issue ALC-99 in Alicorn.')
  })
})
