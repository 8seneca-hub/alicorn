// Channel names live here so main and preload cannot drift: a typo in either
// half is a handler that silently never fires.
export const ALICORN_IPC = {
  projectsList: 'alicorn:projects:list',
  projectsCreate: 'alicorn:projects:create',
  projectsUpdate: 'alicorn:projects:update',
  projectsDelete: 'alicorn:projects:delete',
  membersList: 'alicorn:members:list',
  membersCreate: 'alicorn:members:create',
  membersUpdate: 'alicorn:members:update',
  membersDelete: 'alicorn:members:delete',
  orgPolicyGet: 'alicorn:orgPolicy:get',
  requiredChecksGet: 'alicorn:requiredChecks:get',
  requiredChecksSet: 'alicorn:requiredChecks:set',
  tasksList: 'alicorn:tasks:list',
  tasksCreate: 'alicorn:tasks:create',
  tasksUpdate: 'alicorn:tasks:update',
  tasksDelete: 'alicorn:tasks:delete',
  autonomyPoliciesList: 'alicorn:autonomyPolicies:list',
  mcpConfigPath: 'alicorn:mcp:configPath',
  mcpGlobalServers: 'alicorn:mcp:globalServers',
  tasksWorktreesList: 'alicorn:tasks:worktrees:list',
  tasksWorktreesBind: 'alicorn:tasks:worktrees:bind',
  sessionGet: 'alicorn:session:get',
  sessionBind: 'alicorn:session:bind',
  tasksSetExecutionStrategy: 'alicorn:tasks:setExecutionStrategy',
  foremanJournal: 'alicorn:foreman:journal',
  provenanceGet: 'alicorn:provenance:get',
  runInspectorGet: 'alicorn:runInspector:get',
  contextCaptureGet: 'alicorn:contextCapture:get',
  gatesList: 'alicorn:gates:list',
  gatesResolve: 'alicorn:gates:resolve',
  ruleProposalsList: 'alicorn:ruleProposals:list',
  ruleProposalsAccept: 'alicorn:ruleProposals:accept',
  ruleProposalsReject: 'alicorn:ruleProposals:reject',
  workflowsList: 'alicorn:workflows:list',
  workflowGet: 'alicorn:workflows:get',
  workflowTemplatesList: 'alicorn:workflowTemplates:list',
  workflowCreate: 'alicorn:workflows:create',
  workflowUpdate: 'alicorn:workflows:update',
  workflowCreateFromTemplate: 'alicorn:workflows:createFromTemplate'
} as const

export const ALICORN_EVENTS = {
  escalationOffer: 'alicorn:escalationOffer'
} as const
