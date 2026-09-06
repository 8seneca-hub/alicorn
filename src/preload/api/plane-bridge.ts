import { ipcRenderer } from 'electron'
import type { PlaneApi } from './plane-api'

export const planeApi: PlaneApi = {
  connect: (args) => ipcRenderer.invoke('plane:connect', args),
  disconnect: (args) => ipcRenderer.invoke('plane:disconnect', args),
  status: () => ipcRenderer.invoke('plane:status'),
  setDefaultProject: (args) => ipcRenderer.invoke('plane:setDefaultProject', args),
  listProjects: (args) => ipcRenderer.invoke('plane:listProjects', args),
  listStates: (args) => ipcRenderer.invoke('plane:listStates', args),
  listMembers: (args) => ipcRenderer.invoke('plane:listMembers', args),
  listIssues: (args) => ipcRenderer.invoke('plane:listIssues', args),
  getIssue: (args) => ipcRenderer.invoke('plane:getIssue', args)
}
