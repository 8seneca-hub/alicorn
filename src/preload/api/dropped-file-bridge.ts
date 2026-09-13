/**
 * The path behind a file the user dropped.
 *
 * `webUtils.getPathForFile` is preload-only by design — the renderer holds a `File` with no path on
 * it, which is the whole point of the sandbox. Alicorn's own drop targets need the path rather than
 * the bytes: a brief that names `src/foo.ts` is worth more to an agent than the same file pasted
 * into a prompt, because the agent can read the current version and the paste is a snapshot.
 *
 * Returns '' for anything that is not a real file on disk — a dragged selection, a URL, a file from
 * a virtual provider — so a caller filters rather than guessing.
 */
import { webUtils } from 'electron'

export type DroppedFileApi = {
  pathForFile: (file: File) => string
}

export const droppedFileApi: DroppedFileApi = {
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  }
}
