import { createInterface } from 'node:readline'
import type { CommandHandler } from '../dispatch'
import { handleMcpLine } from '../mcp/alicorn-mcp-protocol'

/**
 * `alicorn mcp serve` — the Alicorn control plane as an MCP server, over stdio.
 *
 * It is a CLI command rather than its own binary because the CLI already knows how to reach the
 * running app: every tool call is a runtime RPC, so the agent never holds a control-plane bearer
 * and a worker terminal cannot read one. That is the same seam `alicorn ledger report` uses.
 *
 * stdout carries the protocol and nothing else. Anything this process wants to say to a human goes
 * to stderr, because one stray log line on stdout is a corrupt frame and a dead session.
 */

/**
 * `RuntimeClient.call` answers the whole envelope (`{ id, ok, result }`), which is the shape every
 * other caller reads through as `response.result`. A tool must hand the model the payload alone:
 * the envelope's `id` is noise, and a receipt reading `result.task` off the envelope finds nothing.
 */
export function unwrapRpcResult(response: unknown): Record<string, unknown> {
  if (response && typeof response === 'object') {
    const envelope = response as { ok?: unknown; result?: unknown }
    if (envelope.result && typeof envelope.result === 'object') {
      return envelope.result as Record<string, unknown>
    }
    if ('ok' in envelope) {
      return {}
    }
    return response as Record<string, unknown>
  }
  return {}
}

export const MCP_HANDLERS: Record<string, CommandHandler> = {
  'mcp serve': async ({ client }) => {
    const lines = createInterface({ input: process.stdin })
    for await (const line of lines) {
      const response = await handleMcpLine(line, async (method, params) =>
        unwrapRpcResult(await client.call<unknown>(method, params))
      )
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`)
      }
    }
  }
}
