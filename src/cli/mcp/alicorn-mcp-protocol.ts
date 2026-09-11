/**
 * The MCP wire, hand-rolled over JSON-RPC 2.0.
 *
 * Why not the SDK: this repo tracks a fast-moving upstream, and its own docs record that a
 * lockfile rewritten by the wrong pnpm silently changes resolutions. A dependency is a permanent
 * merge surface; the three methods a tool server actually needs — `initialize`, `tools/list`,
 * `tools/call` — are a hundred lines, so they are here instead.
 *
 * Transport framing is newline-delimited JSON on stdio, which is what every current MCP client
 * speaks to a stdio server.
 */
import { ALICORN_MCP_TOOLS, findAlicornMcpTool } from './alicorn-mcp-tools'

/** The revision this server implements. Clients negotiate down, never up. */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

export type ToolCaller = (method: string, params: Record<string, unknown>) => Promise<unknown>

const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** A tool result: text content, plus `isError` for a failure the model should read and retry. */
function toolText(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

/**
 * Answers one request. Returns null for a notification, which by JSON-RPC gets no reply at all —
 * sending one to `notifications/initialized` makes strict clients drop the connection.
 */
export async function handleMcpRequest(
  request: JsonRpcRequest,
  call: ToolCaller
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null
  if (request.method.startsWith('notifications/')) {
    return null
  }

  if (request.method === 'initialize') {
    return ok(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'alicorn', version: '1' },
      instructions:
        'Alicorn’s control plane. Create and move tasks, and add members to the org library. ' +
        'Every change returns a receipt saying what changed and how to undo it — quote it back to the developer. ' +
        'Required checks, autonomy levels and stage reversibility are deliberately not exposed: a member may not author the criteria that judge it.'
    })
  }

  if (request.method === 'tools/list') {
    return ok(id, {
      tools: ALICORN_MCP_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    })
  }

  if (request.method === 'tools/call') {
    const name = typeof request.params?.name === 'string' ? request.params.name : ''
    const tool = findAlicornMcpTool(name)
    if (!tool) {
      return ok(id, toolText(`No Alicorn tool named "${name}".`, true))
    }
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>
    try {
      const result = ((await call(tool.method, args)) ?? {}) as Record<string, unknown>
      // A writer leads with its receipt so the model quotes the change, not the payload.
      const body = JSON.stringify(result, null, 2)
      const receipt = tool.receipt?.(result, args)
      return ok(id, toolText(receipt ? `${receipt}\n\n${body}` : body))
    } catch (error) {
      // A refused write is the model's to read and retry, not a transport failure.
      return ok(id, toolText(error instanceof Error ? error.message : String(error), true))
    }
  }

  if (request.method === 'ping') {
    return ok(id, {})
  }

  return fail(id, METHOD_NOT_FOUND, `Unsupported MCP method: ${request.method}`)
}

/** Parses one stdio line; a malformed line is answered rather than crashing the server. */
export async function handleMcpLine(
  line: string,
  call: ToolCaller
): Promise<JsonRpcResponse | null> {
  const trimmed = line.trim()
  if (trimmed === '') {
    return null
  }
  let request: JsonRpcRequest
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest
  } catch {
    return fail(null, INTERNAL_ERROR, 'Malformed JSON-RPC request')
  }
  if (typeof request?.method !== 'string') {
    return fail(request?.id ?? null, INTERNAL_ERROR, 'Request has no method')
  }
  return handleMcpRequest(request, call)
}
