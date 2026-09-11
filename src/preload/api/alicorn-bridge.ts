import { ipcRenderer } from 'electron'
import { ALICORN_EVENTS, ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { EscalationOffer } from '../../shared/alicorn/escalation-offer'
import type { AlicornApi } from './alicorn-api'

export const alicornApi: AlicornApi = {
  listProjects: () => ipcRenderer.invoke(ALICORN_IPC.projectsList),
  createProject: (input) => ipcRenderer.invoke(ALICORN_IPC.projectsCreate, input),
  updateProject: (id, input) => ipcRenderer.invoke(ALICORN_IPC.projectsUpdate, { id, input }),
  deleteProject: (id) => ipcRenderer.invoke(ALICORN_IPC.projectsDelete, { id }),
  listMembers: () => ipcRenderer.invoke(ALICORN_IPC.membersList),
  createMember: (input) => ipcRenderer.invoke(ALICORN_IPC.membersCreate, input),
  updateMember: (id, input) => ipcRenderer.invoke(ALICORN_IPC.membersUpdate, { id, input }),
  deleteMember: (id) => ipcRenderer.invoke(ALICORN_IPC.membersDelete, { id }),
  getOrgPolicy: () => ipcRenderer.invoke(ALICORN_IPC.orgPolicyGet),
  getRequiredChecks: (projectId) =>
    ipcRenderer.invoke(ALICORN_IPC.requiredChecksGet, { projectId }),
  setTaskExecutionStrategy: (args) =>
    ipcRenderer.invoke(ALICORN_IPC.tasksSetExecutionStrategy, args),
  getForemanRun: (worktreeId) => ipcRenderer.invoke(ALICORN_IPC.foremanJournal, { worktreeId }),
  getProvenance: (args) => ipcRenderer.invoke(ALICORN_IPC.provenanceGet, args),
  getRunInspector: (args) => ipcRenderer.invoke(ALICORN_IPC.runInspectorGet, args),
  getContextCapture: (args) => ipcRenderer.invoke(ALICORN_IPC.contextCaptureGet, args),
  listPendingGates: () => ipcRenderer.invoke(ALICORN_IPC.gatesList),
  resolveGate: (args) => ipcRenderer.invoke(ALICORN_IPC.gatesResolve, args),
  listRuleProposals: (args) => ipcRenderer.invoke(ALICORN_IPC.ruleProposalsList, args),
  acceptRuleProposal: (args) => ipcRenderer.invoke(ALICORN_IPC.ruleProposalsAccept, args),
  rejectRuleProposal: (args) => ipcRenderer.invoke(ALICORN_IPC.ruleProposalsReject, args),
  listWorkflows: (projectId) => ipcRenderer.invoke(ALICORN_IPC.workflowsList, { projectId }),
  getWorkflow: (id) => ipcRenderer.invoke(ALICORN_IPC.workflowGet, { id }),
  listWorkflowTemplates: () => ipcRenderer.invoke(ALICORN_IPC.workflowTemplatesList),
  createWorkflow: (graph) => ipcRenderer.invoke(ALICORN_IPC.workflowCreate, { graph }),
  updateWorkflow: (args) => ipcRenderer.invoke(ALICORN_IPC.workflowUpdate, args),
  createWorkflowFromTemplate: (args) =>
    ipcRenderer.invoke(ALICORN_IPC.workflowCreateFromTemplate, args),

  // Returns an unsubscribe rather than exposing removeListener, so a renderer
  // cannot detach another subscriber's handler.
  onEscalationOffer: (callback) => {
    const listener = (_event: unknown, payload: EscalationOffer): void => callback(payload)
    ipcRenderer.on(ALICORN_EVENTS.escalationOffer, listener)
    return () => ipcRenderer.removeListener(ALICORN_EVENTS.escalationOffer, listener)
  }
}
