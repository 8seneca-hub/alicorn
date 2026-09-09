// Hand-mirrored from cloud/packages/control-plane-contract/src/member.ts.
// Field names must stay identical — the desktop does not import the contract
// package, so a rename there is a silent break here.

export const MEMBER_BACKENDS = ['claude', 'codex', 'grok', 'openclaude'] as const
export const MEMBER_ROLES = ['developer', 'reviewer', 'qa', 'analyst', 'other'] as const
export const WORKSPACE_KINDS = ['worktree', 'folder'] as const
export const PERMISSION_MODES = ['ask', 'accept_edits', 'yolo'] as const

export type MemberBackend = (typeof MEMBER_BACKENDS)[number]
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number]
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export type MemberInput = {
  name: string
  role: MemberRole
  backend: MemberBackend
  workspaceKind: WorkspaceKind
  permissionMode: PermissionMode
  systemRules: string
  skills: string[]
}

export type Member = MemberInput & {
  id: string
  tenantId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// Why a boolean and not a mode: decision §11.4 — enforced by default, explicit
// opt-out, bypass recorded on the run.
export type OrgPolicy = {
  enforceDistinctReviewerBackend: boolean
}

export type DiffCoverageCheck = {
  kind: 'diff_coverage'
  threshold: number
  lcovPath: string
  command?: string
  timeoutMs: number
}

/** CR2: no parameters — what is breaking is the registry's answer, who may accept it is the API's. */
export type ContractAcknowledgedCheck = {
  kind: 'contract_acknowledged'
}

export type RequiredCheck = DiffCoverageCheck | ContractAcknowledgedCheck
