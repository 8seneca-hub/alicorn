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

/**
 * Hand-mirrored from the contract's `MemberSkillRefSchema` (OP2/SP1). `versionId: null` follows
 * the catalog's `latest`; a value pins and survives `latest` moving. The API still accepts a bare
 * string for the pre-catalog shape, so this is additive on the wire.
 */
export type MemberSkillRef = {
  name: string
  versionId: string | null
}

export type MemberInput = {
  name: string
  role: MemberRole
  backend: MemberBackend
  workspaceKind: WorkspaceKind
  permissionMode: PermissionMode
  systemRules: string
  skills: MemberSkillRef[]
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

/**
 * IV1: an admin-authored command proving the feature still works across the repositories it spans.
 * `repoId` names which of the task's bound workspaces hosts it. No timeout knob — the ceiling is
 * the evaluator's, so it is not a criterion the member being judged can argue with.
 */
export type IntegrationVerifyCheck = {
  kind: 'integration_verify'
  command: string
  repoId: string
}

/**
 * OP2b: the check names a catalog skill. `skillId` is a catalog row and a member's private skill
 * has no id, so a member cannot name — or loosen — what judges it. Omitting `versionId` follows
 * the catalog's `latest`.
 */
export type SkillCheck = {
  kind: 'skill'
  skillId: string
  versionId?: string
}

export type RequiredCheck =
  | DiffCoverageCheck
  | ContractAcknowledgedCheck
  | IntegrationVerifyCheck
  | SkillCheck
