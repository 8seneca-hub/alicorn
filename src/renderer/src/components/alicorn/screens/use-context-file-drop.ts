/**
 * Dropping files onto a brief.
 *
 * Paths, not contents. An agent that is given `src/foo.ts` reads the file that exists when it looks;
 * a brief with the file pasted into it carries a snapshot that was already stale when it was taken,
 * and costs context to boot. So a drop appends the paths and the agent decides what to open.
 *
 * Paths are relative to the workspace when they sit inside it, because that is the form every other
 * surface uses and the form an agent can act on without knowing whose machine this is.
 */
import React from 'react'

function toRelative(path: string, root: string | null): string {
  if (!root) {
    return path
  }
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

export type ContextFileDrop = {
  dragging: boolean
  handlers: {
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  }
}

export function useContextFileDrop(args: {
  /** Called with the text to append; the field owns how it merges. */
  onPaths: (text: string) => void
  /** Workspace root, so paths inside it read relative. */
  root?: string | null
}): ContextFileDrop {
  const { onPaths, root = null } = args
  const [dragging, setDragging] = React.useState(false)

  const onDrop = React.useCallback(
    (event: React.DragEvent): void => {
      event.preventDefault()
      setDragging(false)
      const bridge = window.api?.droppedFile
      if (!bridge) {
        return
      }
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => bridge.pathForFile(file))
        .filter((path) => path.length > 0)
        .map((path) => toRelative(path, root))
      if (paths.length > 0) {
        onPaths(paths.join('\n'))
      }
    },
    [onPaths, root]
  )

  return {
    dragging,
    handlers: {
      // Without preventDefault on dragover the browser refuses the drop and opens the file instead.
      onDragOver: (event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      },
      onDragLeave: () => setDragging(false),
      onDrop
    }
  }
}
