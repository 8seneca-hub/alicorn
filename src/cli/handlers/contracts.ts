import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag, getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime/types'
import { mockContractFromWorktree } from '../../main/alicorn/contracts/mock-from-worktree'

/**
 * Local by design — no runtime call. The mock is derived from the worktree's own OpenAPI documents,
 * so it works in a worker's terminal with no Alicorn server running and no control-plane token.
 */
export const CONTRACT_HANDLERS: Record<string, CommandHandler> = {
  'contracts mock': async ({ flags, cwd, json }) => {
    const name = getRequiredStringFlag(flags, 'name')
    const mock = await mockContractFromWorktree(cwd, name)
    if (!mock) {
      throw new RuntimeClientError(
        'not_found',
        `No OpenAPI schema named "${name}" in this worktree. Registry entries extracted from TypeScript have no schema to mock.`
      )
    }
    const body = `${JSON.stringify(mock.value, null, 2)}\n`
    const out = getOptionalStringFlag(flags, 'out')
    if (out) {
      await writeFile(resolve(cwd, out), body, 'utf8')
    }
    if (json) {
      console.log(JSON.stringify(mock, null, 2))
      return
    }
    console.log(out ? `wrote ${out} from ${mock.document}#${mock.source}` : body.trimEnd())
  }
}
