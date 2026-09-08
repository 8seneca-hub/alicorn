import { ipcRenderer } from 'electron'
import { ALICORN_EVENTS, ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { EscalationOffer } from '../../shared/alicorn/context-ceiling'
import type { AlicornApi } from './alicorn-api'

export const alicornApi: AlicornApi = {
  listMembers: () => ipcRenderer.invoke(ALICORN_IPC.membersList),
  createMember: (input) => ipcRenderer.invoke(ALICORN_IPC.membersCreate, input),
  updateMember: (id, input) => ipcRenderer.invoke(ALICORN_IPC.membersUpdate, { id, input }),
  deleteMember: (id) => ipcRenderer.invoke(ALICORN_IPC.membersDelete, { id }),
  getOrgPolicy: () => ipcRenderer.invoke(ALICORN_IPC.orgPolicyGet),
  setTaskExecutionStrategy: (args) =>
    ipcRenderer.invoke(ALICORN_IPC.tasksSetExecutionStrategy, args),
  getForemanRun: (worktreeId) => ipcRenderer.invoke(ALICORN_IPC.foremanJournal, { worktreeId }),
  getProvenance: (args) => ipcRenderer.invoke(ALICORN_IPC.provenanceGet, args),

  // Returns an unsubscribe rather than exposing removeListener, so a renderer
  // cannot detach another subscriber's handler.
  onEscalationOffer: (callback) => {
    const listener = (_event: unknown, payload: EscalationOffer): void => callback(payload)
    ipcRenderer.on(ALICORN_EVENTS.escalationOffer, listener)
    return () => ipcRenderer.removeListener(ALICORN_EVENTS.escalationOffer, listener)
  }
}
