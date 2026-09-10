/**
 * Reading an MCP config, merging one server into it, and writing it back.
 *
 * Split out of `McpConfigSection` so the section stays within its line budget, and because the
 * read-merge-write sequence is the part worth reading on its own: a missing file is the create
 * case, and a file that will not parse is left exactly as it is.
 */
import { useAppStore } from '../../store'
import { extractIpcErrorMessage } from '../../lib/ipc-error'
import { captureDirectSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import { upsertMcpServer, type McpServerDraft } from '../../../../shared/mcp-config-write'

export type McpAddServerOutcome =
  | { status: 'added' | 'replaced' }
  | { status: 'refused'; reason: 'invalid_name' | 'unreadable' }
  | { status: 'failed'; message: string }

export async function writeMcpServerToConfig(args: {
  targetPath: string
  connectionId: string | undefined
  draft: McpServerDraft
}): Promise<McpAddServerOutcome> {
  const { targetPath, connectionId, draft } = args
  try {
    // A read failure here is the missing-file case in practice; the merge treats null as "create".
    let existing: string | null = null
    try {
      const read = await window.api.fs.readFile({ filePath: targetPath, connectionId })
      existing = read.isBinary ? '' : read.content
    } catch {
      existing = null
    }

    const merged = upsertMcpServer(existing, draft)
    if (!merged.ok) {
      return {
        status: 'refused',
        reason: merged.reason === 'invalid_name' ? 'invalid_name' : 'unreadable'
      }
    }

    const sshExpectation = connectionId
      ? captureDirectSshMutationExpectation(useAppStore.getState(), connectionId)
      : {}
    await window.api.fs.writeFile({
      filePath: targetPath,
      content: merged.content,
      connectionId,
      ...sshExpectation
    })
    return { status: merged.replaced ? 'replaced' : 'added' }
  } catch (error) {
    return {
      status: 'failed',
      message: extractIpcErrorMessage(error, 'Unable to write the MCP config.')
    }
  }
}
