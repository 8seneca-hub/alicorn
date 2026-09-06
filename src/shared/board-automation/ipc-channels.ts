// Channel names live here so main and preload cannot drift: a typo in either half is a handler
// that silently never fires.
export const BOARD_AUTOMATION_IPC = {
  status: 'boardAutomation:status',
  setKilled: 'boardAutomation:setKilled',
  listRules: 'boardAutomation:listRules',
  saveRules: 'boardAutomation:saveRules'
} as const
