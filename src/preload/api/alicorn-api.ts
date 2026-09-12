import type { EscalationOffer } from '../../shared/alicorn/escalation-offer'
import type { ForemanRunViewResult } from '../../shared/alicorn/foreman-run'
import type { Member, MemberInput, OrgPolicy, RequiredCheck } from '../../shared/alicorn/members'
import type { Project, ProjectInput } from '../../shared/alicorn/projects'
import type { AutonomyPolicy } from '../../shared/alicorn/gate-policy'
import type { Task, TaskInput, TaskPatch } from '../../shared/alicorn/tasks'
import type {
  TaskWorktreeTuple,
  TaskWorktreeTupleInput
} from '../../shared/alicorn/feature-workspace-tuples'
import type { TaskSessionBinding } from '../../shared/alicorn/task-session'
import type { McpServerSummary } from '../../shared/mcp-config'
import type { ProvenanceViewResult } from '../../shared/alicorn/provenance-view'
import type {
  ContextCaptureDetailResult,
  RunInspectorViewResult
} from '../../shared/alicorn/run-inspector-view'
import type { GateResolveResult, PendingGatesResult } from '../../shared/alicorn/gate-review'
import type {
  RuleProposalDecisionResult,
  RuleProposalsListResult,
  RuleProposalStatus
} from '../../shared/alicorn/rule-proposals'
import type {
  Workflow,
  WorkflowGraphInput,
  WorkflowSummary,
  WorkflowTemplate
} from '../../shared/alicorn/workflows'

export type AlicornFailure = { ok: false; error: string }

export type AlicornApi = {
  /** Projects own their repositories; a repository belongs to at most one. */
  listProjects: () => Promise<{ ok: true; projects: Project[] } | AlicornFailure>
  createProject: (input: ProjectInput) => Promise<{ ok: true; project: Project } | AlicornFailure>
  updateProject: (
    id: string,
    input: ProjectInput
  ) => Promise<{ ok: true; project: Project } | AlicornFailure>
  deleteProject: (id: string) => Promise<{ ok: true } | AlicornFailure>
  /** The board's rows for one project. A task is the unit of work, not a worktree. */
  listTasks: (projectId: string) => Promise<{ ok: true; tasks: Task[] } | AlicornFailure>
  createTask: (input: TaskInput) => Promise<{ ok: true; task: Task } | AlicornFailure>
  updateTask: (id: string, patch: TaskPatch) => Promise<{ ok: true; task: Task } | AlicornFailure>
  deleteTask: (id: string) => Promise<{ ok: true } | AlicornFailure>
  /** A project's autonomy policies. Read-only: authored by an admin, never by the member judged. */
  listAutonomyPolicies: (
    projectId: string
  ) => Promise<{ ok: true; policies: AutonomyPolicy[] } | AlicornFailure>
  /** Path to the MCP config a session Alicorn starts is pointed at, written on demand. */
  mcpConfigPath: () => Promise<{ ok: true; path: string } | AlicornFailure>
  /** The servers Claude Code applies to every project on this machine. */
  mcpGlobalServers: () => Promise<
    { ok: true; path: string; servers: McpServerSummary[] } | AlicornFailure
  >
  /** The (repo, branch, worktree) tuples a task is being worked on in. Client-side state. */
  listTaskWorktrees: (
    taskId: string
  ) => Promise<{ ok: true; tuples: TaskWorktreeTuple[] } | AlicornFailure>
  /** Whole-set replace: `primary` is a property of the set, so a partial write can leave two. */
  bindTaskWorktrees: (
    taskId: string,
    tuples: TaskWorktreeTupleInput[]
  ) => Promise<{ ok: true; tuples: TaskWorktreeTuple[] } | AlicornFailure>
  /**
   * The chat session a subject is worked in — a task id, or `project:<id>` for a project's chat.
   * One per subject; null until someone starts it.
   */
  getSubjectSession: (
    subjectId: string
  ) => Promise<{ ok: true; session: TaskSessionBinding | null } | AlicornFailure>
  bindSubjectSession: (
    subjectId: string,
    session: TaskSessionBinding
  ) => Promise<{ ok: true; session: TaskSessionBinding } | AlicornFailure>
  listMembers: () => Promise<{ ok: true; members: Member[] } | AlicornFailure>
  createMember: (input: MemberInput) => Promise<{ ok: true; member: Member } | AlicornFailure>
  updateMember: (
    id: string,
    input: MemberInput
  ) => Promise<{ ok: true; member: Member } | AlicornFailure>
  deleteMember: (id: string) => Promise<{ ok: true } | AlicornFailure>
  getOrgPolicy: () => Promise<{ ok: true; policy: OrgPolicy } | AlicornFailure>
  /** Admin-authored per project, and read-only here: a member cannot loosen what judges it. */
  getRequiredChecks: (
    projectId: string
  ) => Promise<{ ok: true; checks: RequiredCheck[] } | AlicornFailure>
  setTaskExecutionStrategy: (args: {
    taskId: string
    strategy: 'single' | 'orchestrated'
    source: 'user' | 'escalation'
  }) => Promise<{ ok: boolean }>
  onEscalationOffer: (callback: (payload: EscalationOffer) => void) => () => void
  /** The journal the given workspace's run is keeping, read from disk on every call. */
  getForemanRun: (worktreeId: string) => Promise<ForemanRunViewResult>
  /** Everything the ledger recorded for a branch, already projected for display. */
  getProvenance: (args: { repoId: string; branch: string }) => Promise<ProvenanceViewResult>
  /** One run of a branch: its dispatches, where each prompt lives, and what the run cost.
   *  Carries no prompt text — `getContextCapture` fetches a body for one dispatch. */
  getRunInspector: (args: {
    repoId: string
    branch: string
    runId?: string | null
  }) => Promise<RunInspectorViewResult>
  /** The exact prompt and context slice one dispatch was given. */
  getContextCapture: (args: {
    runId: string
    dispatchId: string
  }) => Promise<ContextCaptureDetailResult>
  /** Gates still waiting on a human, with the policy's recommendation where level 1 allows it. */
  listPendingGates: () => Promise<PendingGatesResult>
  /** Resolves a gate and records whether the human's call matched the policy's (GP3). */
  resolveGate: (args: {
    gateId: string
    resolution: string
    humanGateDecision: 'gate' | 'auto'
  }) => Promise<GateResolveResult>
  /** Standing rules a correction proposed for this member, newest first (RB1). */
  listRuleProposals: (args: {
    memberId: string
    status?: RuleProposalStatus
  }) => Promise<RuleProposalsListResult>
  /**
   * Accepts a proposal with the rule a human wrote, appending it to the member's system rules and
   * — unless `commitToRepo` is false — committing it into `worktreeId`'s repository.
   */
  acceptRuleProposal: (args: {
    id: string
    rule: string
    memberName: string
    worktreeId: string | null
    commitToRepo: boolean
  }) => Promise<RuleProposalDecisionResult>
  rejectRuleProposal: (args: { id: string }) => Promise<RuleProposalDecisionResult>
  /** WF2's canvas. The Control API stays the authority on what graph is legal. */
  listWorkflows: (
    projectId: string
  ) => Promise<{ ok: true; workflows: WorkflowSummary[] } | AlicornFailure>
  getWorkflow: (id: string) => Promise<WorkflowResult>
  listWorkflowTemplates: () => Promise<{ ok: true; templates: WorkflowTemplate[] } | AlicornFailure>
  createWorkflow: (graph: WorkflowGraphInput) => Promise<WorkflowResult>
  /** `version` is the one the canvas loaded; a `version_conflict` error means someone else saved. */
  updateWorkflow: (args: {
    id: string
    version: number
    graph: WorkflowGraphInput
  }) => Promise<WorkflowResult>
  createWorkflowFromTemplate: (args: {
    projectId: string
    templateKey: string
    name?: string
  }) => Promise<WorkflowResult>
}

export type WorkflowResult = { ok: true; workflow: Workflow } | AlicornFailure
