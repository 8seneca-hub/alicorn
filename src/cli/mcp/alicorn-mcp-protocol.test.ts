import { parseAlicornReceipt } from '../../shared/alicorn/receipt'
import { describe, expect, it, vi } from 'vitest'
import { handleMcpLine, handleMcpRequest, MCP_PROTOCOL_VERSION } from './alicorn-mcp-protocol'
import { ALICORN_MCP_TOOLS } from './alicorn-mcp-tools'

const noCall = vi.fn(async () => ({}))

function text(response: unknown): string {
  const result = (response as { result?: { content?: { text?: string }[] } }).result
  return result?.content?.[0]?.text ?? ''
}

describe('the Alicorn MCP server', () => {
  it('answers initialize with the protocol version and its tool capability', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, noCall)

    expect(response?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'alicorn' }
    })
  })

  // A reply to a notification makes strict clients drop the connection.
  it('says nothing at all to a notification', async () => {
    expect(
      await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, noCall)
    ).toBeNull()
  })

  it('lists every tool with a schema', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, noCall)
    const tools = (response!.result as { tools: { name: string; inputSchema: unknown }[] }).tools

    expect(tools.map((tool) => tool.name)).toEqual(ALICORN_MCP_TOOLS.map((tool) => tool.name))
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
    }
  })

  // §5: an agent must not be able to author the criteria that judge it.
  it('exposes no tool that authors a required check, an autonomy level or a hard stop', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, noCall)
    const names = (response!.result as { tools: { name: string }[] }).tools.map((t) => t.name)

    for (const forbidden of ['check', 'autonomy', 'reversibility', 'gate', 'policy']) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false)
    }
  })

  it('calls the tool’s runtime method with the model’s arguments', async () => {
    const call = vi.fn(async () => ({
      task: { id: 'tsk_1', number: 7, title: 'Refunds', column: 'todo' }
    }))

    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'alicorn_create_task', arguments: { projectId: 'prj_1', title: 'Refunds' } }
      },
      call
    )

    expect(call).toHaveBeenCalledWith('alicorn.taskCreate', {
      projectId: 'prj_1',
      title: 'Refunds'
    })
  })

  // §3: every mutation returns a receipt — what changed, and undo.
  it('leads a write with a receipt that names the change and the undo', async () => {
    const call = vi.fn(async () => ({
      task: { id: 'tsk_1', number: 7, title: 'Refunds', column: 'todo' }
    }))

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'alicorn_create_task', arguments: { projectId: 'prj_1', title: 'Refunds' } }
      },
      call
    )

    // The sentence is for the model; the leading line is for the app, which turns it into a row
    // with an Undo button rather than asking a human to act on prose.
    expect(text(response)).toContain('Created task #7 \u201cRefunds\u201d in todo')
    const receipt = parseAlicornReceipt(text(response))
    expect(receipt?.summary).toContain('Created task #7')
    expect(receipt?.undo).toEqual({ action: 'task.delete', args: { taskId: 'tsk_1' } })
  })

  // Deletion is not in the agent's tool set, so an undo must never read as one it could call.
  it('names an app action for the undo, never a tool', async () => {
    const call = vi.fn(async () => ({
      task: { id: 'tsk_2', number: 8, title: 'Retries', column: 'in-review' },
      previous: { column: 'in-progress' }
    }))

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'alicorn_update_task',
          arguments: { taskId: 'tsk_2', column: 'in-review' }
        }
      },
      call
    )

    expect(parseAlicornReceipt(text(response))?.undo).toEqual({
      action: 'task.update',
      args: { taskId: 'tsk_2', column: 'in-progress' }
    })
  })

  // Import is two primitives, not a bespoke importer: the agent brings its own PM MCP server.
  it('offers creating a project so an agent can import a board', async () => {
    const call = vi.fn(async () => ({
      project: { id: 'prj_1', name: 'Payments Platform', key: 'PAY' }
    }))

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'alicorn_create_project',
          arguments: { name: 'Payments Platform', key: 'PAY', repoIds: ['repo-a'] }
        }
      },
      call
    )

    expect(call).toHaveBeenCalledWith('alicorn.projectCreate', {
      name: 'Payments Platform',
      key: 'PAY',
      repoIds: ['repo-a']
    })
    expect(text(response)).toContain('Created project Payments Platform (PAY).')
  })

  it('names the issue a task was imported from in its receipt', async () => {
    const call = vi.fn(async () => ({
      task: { id: 'tsk_1', number: 7, title: 'Refunds', column: 'todo' }
    }))

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'alicorn_create_task',
          arguments: {
            projectId: 'prj_1',
            title: 'Refunds',
            source: { provider: 'plane', ref: 'ALC-11' }
          }
        }
      },
      call
    )

    expect(text(response)).toContain('from ALC-11')
  })

  it('gives a read no receipt', async () => {
    const call = vi.fn(async () => ({ projects: [] }))
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'alicorn_list_projects' } },
      call
    )

    expect(text(response)).not.toContain('Undo')
  })

  it('hands a refused write back to the model rather than failing the transport', async () => {
    const call = vi.fn(async () => {
      throw new Error('control_plane_unconfigured')
    })

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'alicorn_create_task', arguments: { projectId: 'p', title: 't' } }
      },
      call
    )

    expect(response?.error).toBeUndefined()
    expect((response!.result as { isError?: boolean }).isError).toBe(true)
    expect(text(response)).toContain('control_plane_unconfigured')
  })

  it('names an unknown tool instead of pretending it ran', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'alicorn_delete_everything' }
      },
      noCall
    )

    expect((response!.result as { isError?: boolean }).isError).toBe(true)
    expect(text(response)).toContain('alicorn_delete_everything')
  })

  it('refuses a method it does not implement', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 9, method: 'resources/list' },
      noCall
    )

    expect(response?.error?.code).toBe(-32601)
  })
})

describe('stdio framing', () => {
  it('ignores a blank keepalive line', async () => {
    expect(await handleMcpLine('   ', noCall)).toBeNull()
  })

  it('answers malformed JSON rather than dying mid-session', async () => {
    const response = await handleMcpLine('{not json', noCall)

    expect(response?.error?.message).toContain('Malformed')
  })

  it('answers a line with no method', async () => {
    const response = await handleMcpLine('{"jsonrpc":"2.0","id":3}', noCall)

    expect(response?.error?.message).toContain('no method')
  })
})
