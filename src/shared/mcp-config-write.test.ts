import { describe, expect, it } from 'vitest'
import {
  isValidMcpServerName,
  parseMcpServerArgs,
  parseMcpServerEnvNames,
  upsertMcpServer,
  type McpServerDraft
} from './mcp-config-write'

const PLANE: McpServerDraft = {
  name: 'plane',
  command: 'npx',
  args: ['-y', 'some-plane-mcp'],
  env: ['PLANE_API_KEY']
}

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>
}

describe('upsertMcpServer', () => {
  it('creates a config when there is no file yet', () => {
    const result = upsertMcpServer(null, PLANE)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(parse(result.content)).toEqual({
      mcpServers: {
        plane: {
          command: 'npx',
          args: ['-y', 'some-plane-mcp'],
          env: { PLANE_API_KEY: '${PLANE_API_KEY}' }
        }
      }
    })
    expect(result.replaced).toBe(false)
  })

  // The whole reason this is a merge: these files are shared with Cursor and Claude.
  it('keeps every server already in the file', () => {
    const existing = JSON.stringify({
      mcpServers: { github: { command: 'gh-mcp', args: [] } }
    })
    const result = upsertMcpServer(existing, PLANE)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const config = parse(result.content) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(config.mcpServers).sort()).toEqual(['github', 'plane'])
  })

  it('keeps unrelated top-level keys the file carries', () => {
    const existing = JSON.stringify({ someOtherTool: { enabled: true }, mcpServers: {} })
    const result = upsertMcpServer(existing, PLANE)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(parse(result.content).someOtherTool).toEqual({ enabled: true })
  })

  it('reports replacing a server of the same name rather than doing it silently', () => {
    const existing = JSON.stringify({ mcpServers: { plane: { command: 'old', args: [] } } })
    const result = upsertMcpServer(existing, PLANE)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.replaced).toBe(true)
  })

  // Secrets are resolved by the launching process; a value must never rest in a file we wrote.
  it('emits env variable names as placeholders, never values', () => {
    const result = upsertMcpServer(null, { ...PLANE, env: ['PLANE_API_KEY', 'PLANE_BASE_URL'] })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.content).toContain('"PLANE_API_KEY": "${PLANE_API_KEY}"')
    expect(result.content).toContain('"PLANE_BASE_URL": "${PLANE_BASE_URL}"')
  })

  it('omits env entirely when the draft names none', () => {
    const result = upsertMcpServer(null, { ...PLANE, env: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const config = parse(result.content) as { mcpServers: { plane: Record<string, unknown> } }
    expect(config.mcpServers.plane).not.toHaveProperty('env')
  })

  // Refusing beats overwriting: an unparseable file is one someone is mid-edit in.
  it('refuses a file it cannot parse instead of overwriting it', () => {
    const result = upsertMcpServer('{ "mcpServers": { ', PLANE)
    expect(result).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('refuses a config whose root is not an object', () => {
    expect(upsertMcpServer('[]', PLANE)).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('refuses when mcpServers is present but not an object, so nothing is dropped', () => {
    const existing = JSON.stringify({ mcpServers: ['github'] })
    expect(upsertMcpServer(existing, PLANE)).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('rejects a name that would not address cleanly', () => {
    expect(upsertMcpServer(null, { ...PLANE, name: 'my server' })).toEqual({
      ok: false,
      reason: 'invalid_name'
    })
  })

  it('writes two-space JSON with a trailing newline, matching the starter config', () => {
    const result = upsertMcpServer(null, PLANE)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.content.endsWith('}\n')).toBe(true)
    expect(result.content).toContain('\n  "mcpServers"')
  })
})

describe('draft parsing', () => {
  it('splits args on whitespace and drops the empties', () => {
    expect(parseMcpServerArgs('  -y   some-plane-mcp  ')).toEqual(['-y', 'some-plane-mcp'])
  })

  it('accepts env names separated by commas or whitespace', () => {
    expect(parseMcpServerEnvNames('PLANE_API_KEY, PLANE_BASE_URL\nPLANE_WORKSPACE')).toEqual([
      'PLANE_API_KEY',
      'PLANE_BASE_URL',
      'PLANE_WORKSPACE'
    ])
  })

  it.each(['plane', 'plane-mcp', 'Plane_2'])('accepts %s as a server name', (name) => {
    expect(isValidMcpServerName(name)).toBe(true)
  })

  it.each(['', 'my server', '-leading', 'has/slash'])('rejects %s as a server name', (name) => {
    expect(isValidMcpServerName(name)).toBe(false)
  })
})
