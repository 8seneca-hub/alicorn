import type { alicornFetch as AlicornFetch } from './control-plane-http'
import { alicornFetch } from './control-plane-http'
import type { ProvenanceReport, RunCost } from '../../shared/alicorn/ledger'
import type { Member, MemberInput, OrgPolicy, RequiredCheck } from '../../shared/alicorn/members'
import type { Workflow, WorkflowSummary } from '../../shared/alicorn/workflows'

export type ControlPlaneClient = {
  listMembers: () => Promise<Member[]>
  createMember: (input: MemberInput) => Promise<Member>
  updateMember: (id: string, input: MemberInput) => Promise<Member>
  deleteMember: (id: string) => Promise<void>
  getOrgPolicy: () => Promise<OrgPolicy>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  getProvenance: (repoId: string, branch: string) => Promise<ProvenanceReport>
  getRunCost: (runId: string) => Promise<RunCost>
  listWorkflows: (projectId: string) => Promise<WorkflowSummary[]>
  getWorkflow: (id: string) => Promise<Workflow>
}

/**
 * Typed reads and member writes over B1's `alicornFetch`. Errors are not caught
 * or reshaped here — `ControlPlaneRequestError` and `ControlPlaneUnavailableError`
 * belong to B1 and surface exactly as it throws them.
 *
 * Ledger *writes* are deliberately absent: they belong to C3's writer, which
 * builds on `alicornFetch` directly and never on this client.
 */
export function createControlPlaneClient(deps?: {
  fetch?: typeof AlicornFetch
}): ControlPlaneClient {
  const request = deps?.fetch ?? alicornFetch

  async function readJson<T>(
    service: 'control' | 'ledger',
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await request(service, path, init)
    return (await response.json()) as T
  }

  function memberBody(input: MemberInput): RequestInit {
    return { method: 'POST', body: JSON.stringify(input) }
  }

  return {
    listMembers: async () => {
      const body = await readJson<{ members: Member[] }>('control', '/v1/members')
      return body.members ?? []
    },

    createMember: async (input) => {
      const body = await readJson<{ member: Member }>('control', '/v1/members', memberBody(input))
      return body.member
    },

    updateMember: async (id, input) => {
      const body = await readJson<{ member: Member }>('control', memberPath(id), {
        ...memberBody(input),
        method: 'PUT'
      })
      return body.member
    },

    // 204 No Content — never parsed, because there is no body to parse.
    deleteMember: async (id) => {
      await request('control', memberPath(id), { method: 'DELETE' })
    },

    getOrgPolicy: () => readJson<OrgPolicy>('control', '/v1/policy/review-backend'),

    getRequiredChecks: async (projectId) => {
      const body = await readJson<{ checks: RequiredCheck[] }>(
        'control',
        `/v1/projects/${encodeURIComponent(projectId)}/required-checks`
      )
      return body.checks ?? []
    },

    getProvenance: (repoId, branch) => {
      const query = new URLSearchParams({ repoId, branch })
      return readJson<ProvenanceReport>('ledger', `/v1/ledger/provenance?${query.toString()}`)
    },

    getRunCost: (runId) =>
      readJson<RunCost>('ledger', `/v1/ledger/runs/${encodeURIComponent(runId)}/cost`),

    listWorkflows: async (projectId) => {
      const query = new URLSearchParams({ projectId })
      const body = await readJson<{ workflows: WorkflowSummary[] }>(
        'control',
        `/v1/workflows?${query.toString()}`
      )
      return body.workflows ?? []
    },

    getWorkflow: async (id) => {
      const body = await readJson<{ workflow: Workflow }>(
        'control',
        `/v1/workflows/${encodeURIComponent(id)}`
      )
      return body.workflow
    }
  }
}

function memberPath(id: string): string {
  return `/v1/members/${encodeURIComponent(id)}`
}
