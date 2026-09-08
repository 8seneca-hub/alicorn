// Channel names live here so main and preload cannot drift: a typo in either
// half is a handler that silently never fires.
export const ALICORN_IPC = {
  membersList: 'alicorn:members:list',
  membersCreate: 'alicorn:members:create',
  membersUpdate: 'alicorn:members:update',
  membersDelete: 'alicorn:members:delete',
  orgPolicyGet: 'alicorn:orgPolicy:get',
  tasksSetExecutionStrategy: 'alicorn:tasks:setExecutionStrategy',
  foremanJournal: 'alicorn:foreman:journal',
  provenanceGet: 'alicorn:provenance:get',
  runInspectorGet: 'alicorn:runInspector:get',
  contextCaptureGet: 'alicorn:contextCapture:get'
} as const

export const ALICORN_EVENTS = {
  escalationOffer: 'alicorn:escalationOffer'
} as const
