import { ipcRenderer } from 'electron'
import { BOARD_AUTOMATION_IPC } from '../../shared/board-automation/ipc-channels'
import type { BoardAutomationApi } from './board-automation-api'

export const boardAutomationApi: BoardAutomationApi = {
  status: (args) => ipcRenderer.invoke(BOARD_AUTOMATION_IPC.status, args),
  setKilled: (args) => ipcRenderer.invoke(BOARD_AUTOMATION_IPC.setKilled, args),
  listRules: (args) => ipcRenderer.invoke(BOARD_AUTOMATION_IPC.listRules, args),
  saveRules: (args) => ipcRenderer.invoke(BOARD_AUTOMATION_IPC.saveRules, args)
}
