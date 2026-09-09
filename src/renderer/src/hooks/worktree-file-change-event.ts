import type { FsChangedPayload } from '../../../shared/filesystem-entry-types'

export const ALICORN_WORKTREE_FILE_CHANGE_EVENT = 'orca:worktree-file-change'

export type WorktreeFileChangeEventDetail = {
  payload: FsChangedPayload
  runtimeEnvironmentId: string | null
}
