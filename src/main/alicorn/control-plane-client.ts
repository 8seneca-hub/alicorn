import type { alicornFetch as AlicornFetch } from './control-plane-http'
import { alicornFetch } from './control-plane-http'
import type {
  ContextCaptureList,
  ContextCaptureRead,
  ProvenanceReport,
  RunCost
} from '../../shared/alicorn/ledger'
import type { Member, MemberInput, OrgPolicy, RequiredCheck } from '../../shared/alicorn/members'
import type {
  AutonomyPolicy,
  AutonomyPolicyInput,
  StageConfig,
  TrackRecord
} from '../../shared/alicorn/gate-policy'
import type { Workflow, WorkflowSummary } from '../../shared/alicorn/workflows'

export type ControlPlaneClient = {
  listMembers: () => Promise<Member[]>
  createMember: (input: MemberInput) => Promise<Member>
  updateMember: (id: string, input: MemberInput) => Promise<Member>
  deleteMember: (id: string) => Promise<void>
  getOrgPolicy: () => Promise<OrgPolicy>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  /** Null when the project has authored no policy — distinct from the control plane being down. */
  getAutonomyPolicy: (key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }) => Promise<AutonomyPolicy | null>
  /** Every authored policy for the project, lapsed exceptions included — the audit view. */
  listAutonomyPolicies: (projectId: string) => Promise<AutonomyPolicy[]>
  putAutonomyPolicy: (projectId: string, input: AutonomyPolicyInput) => Promise<AutonomyPolicy>
  getStageConfig: (projectId: string, stageKey: string) => Promise<StageConfig>
  /** Windowed track record from the Ledger API — `evaluateGate`'s `evidence.stats`. */
  getTrackRecord: (key: {
    projectId: string
    stageKey: string
    memberId: string
  }) => Promise<TrackRecord>
  getProvenance: (repoId: string, branch: string) => Promise<ProvenanceReport>
  getRunCost: (runId: string) => Promise<RunCost>
  /** Capped and flagged by the Ledger API — see `ContextCaptureList.truncated`. */
  listRunContextCaptures: (runId: string) => Promise<ContextCaptureList>
  /** One dispatch's captured body. Throws `not_found` rather than returning an empty capture. */
  getRunContextCapture: (runId: string, dispatchId: string) => Promise<ContextCaptureRead>
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
        `${projectPath(projectId)}/required-checks`
      )
      return body.checks ?? []
    },

    getAutonomyPolicy: async ({ projectId, stageKey, memberId }) => {
      const query = new URLSearchParams({ stageKey })
      if (memberId) {
        query.set('memberId', memberId)
      }
      const body = await readJson<{ policy: AutonomyPolicy | null }>(
        'control',
        `${projectPath(projectId)}/autonomy-policy?${query.toString()}`
      )
      return body.policy ?? null
    },

    listAutonomyPolicies: async (projectId) => {
      const body = await readJson<{ policies: AutonomyPolicy[] }>(
        'control',
        `${projectPath(projectId)}/autonomy-policies`
      )
      return body.policies ?? []
    },

    putAutonomyPolicy: async (projectId, input) => {
      const body = await readJson<{ policy: AutonomyPolicy }>(
        'control',
        `${projectPath(projectId)}/autonomy-policy`,
        { method: 'PUT', body: JSON.stringify(input) }
      )
      return body.policy
    },

    getStageConfig: async (projectId, stageKey) => {
      const body = await readJson<{ config: StageConfig }>(
        'control',
        `${projectPath(projectId)}/stage-config/${encodeURIComponent(stageKey)}`
      )
      return body.config
    },

    getTrackRecord: ({ projectId, stageKey, memberId }) => {
      const query = new URLSearchParams({ projectId, stageKey, memberId })
      return readJson<TrackRecord>('ledger', `/v1/ledger/track-record?${query.toString()}`)
    },

    getProvenance: (repoId, branch) => {
      const query = new URLSearchParams({ repoId, branch })
      return readJson<ProvenanceReport>('ledger', `/v1/ledger/provenance?${query.toString()}`)
    },

    getRunCost: (runId) => readJson<RunCost>('ledger', `${runPath(runId)}/cost`),

    listRunContextCaptures: (runId) =>
      readJson<ContextCaptureList>('ledger', `${runPath(runId)}/context-captures`),

    getRunContextCapture: (runId, dispatchId) =>
      readJson<ContextCaptureRead>(
        'ledger',
        `${runPath(runId)}/context-captures/${encodeURIComponent(dispatchId)}`
      ),

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

function projectPath(projectId: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}`
}

function runPath(runId: string): string {
  return `/v1/ledger/runs/${encodeURIComponent(runId)}`
}

function memberPath(id: string): string {
  return `/v1/members/${encodeURIComponent(id)}`
}
