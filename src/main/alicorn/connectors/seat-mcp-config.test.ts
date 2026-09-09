import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeatConnector } from '../../../shared/alicorn/seat-connectors'
import {
  buildSeatMcpConfig,
  materialiseSeatMcpConfig,
  seatMcpConfigSupported
} from './seat-mcp-config'
import { mergeSeatLaunchRestrictions, resolveSeatMcpConfigForLaunch } from './seat-mcp-launch'
import { appendSeatMcpConfigLaunchArgs } from '../../../shared/tui-agent-launch-defaults'
import type { MemberDirectory } from '../member-directory'

function connector(userId: string, kind: SeatConnector['kind']): SeatConnector {
  return {
    userId,
    kind,
    server: { command: 'npx', args: ['-y', `mcp-${kind}`], env: ['GDRIVE_TOKEN_PATH'] },
    updatedAt: '2026-09-09T00:00:00.000Z'
  }
}

function directory(connectors: SeatConnector[]): MemberDirectory {
  return {
    getSeatConnectors: vi.fn().mockResolvedValue({ seat: 'collaborator', connectors })
  } as unknown as MemberDirectory
}

let userDataPath: string

beforeEach(async () => {
  userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'seat-mcp-'))
})
afterEach(async () => {
  await fs.rm(userDataPath, { recursive: true, force: true })
})

describe('buildSeatMcpConfig', () => {
  it('emits env as a variable reference, never a value', () => {
    expect(buildSeatMcpConfig([connector('usr_a', 'gdrive')])).toEqual({
      mcpServers: {
        gdrive: {
          command: 'npx',
          args: ['-y', 'mcp-gdrive'],
          env: { GDRIVE_TOKEN_PATH: '${GDRIVE_TOKEN_PATH}' }
        }
      }
    })
  })
})

describe('materialiseSeatMcpConfig', () => {
  it('writes one file per seat, and neither holds the other seat s connector', async () => {
    const a = await materialiseSeatMcpConfig({
      userDataPath,
      seatUserId: 'usr_a',
      connectors: [connector('usr_a', 'gdrive')]
    })
    const b = await materialiseSeatMcpConfig({
      userDataPath,
      seatUserId: 'usr_b',
      connectors: [connector('usr_b', 'sharepoint')]
    })
    expect(a).not.toBe(b)
    const first = JSON.parse(await fs.readFile(a!, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    const second = JSON.parse(await fs.readFile(b!, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(Object.keys(first.mcpServers)).toEqual(['gdrive'])
    expect(Object.keys(second.mcpServers)).toEqual(['sharepoint'])
  })

  it('rewrites rather than merges, so a revoked connector cannot survive in a stale file', async () => {
    await materialiseSeatMcpConfig({
      userDataPath,
      seatUserId: 'usr_a',
      connectors: [connector('usr_a', 'gdrive'), connector('usr_a', 'sharepoint')]
    })
    const after = await materialiseSeatMcpConfig({
      userDataPath,
      seatUserId: 'usr_a',
      connectors: [connector('usr_a', 'sharepoint')]
    })
    const written = JSON.parse(await fs.readFile(after!, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(Object.keys(written.mcpServers)).toEqual(['sharepoint'])
  })

  it('answers null with no connectors and with no seat holder', async () => {
    expect(
      await materialiseSeatMcpConfig({ userDataPath, seatUserId: 'usr_a', connectors: [] })
    ).toBeNull()
    expect(
      await materialiseSeatMcpConfig({
        userDataPath,
        seatUserId: null,
        connectors: [connector('usr_a', 'gdrive')]
      })
    ).toBeNull()
  })
})

describe('resolveSeatMcpConfigForLaunch', () => {
  it('withholds on every unresolvable case rather than widening the surface', async () => {
    const dir = directory([connector('usr_a', 'gdrive')])
    expect(
      await resolveSeatMcpConfigForLaunch({ directory: null, backend: 'claude', userDataPath })
    ).toBeNull()
    expect(
      await resolveSeatMcpConfigForLaunch({ directory: dir, backend: null, userDataPath })
    ).toBeNull()
    // A backend with no per-launch config flag loses the connector rather than being launched with
    // the flag silently dropped and the connectors resolved some other way.
    expect(
      await resolveSeatMcpConfigForLaunch({ directory: dir, backend: 'codex', userDataPath })
    ).toBeNull()
    expect(seatMcpConfigSupported('codex')).toBe(false)

    const unreadable = {
      getSeatConnectors: vi.fn().mockRejectedValue(new Error('down'))
    } as unknown as MemberDirectory
    expect(
      await resolveSeatMcpConfigForLaunch({
        directory: unreadable,
        backend: 'claude',
        userDataPath
      })
    ).toBeNull()

    // No seat means no connectors, which is the same withholding by construction.
    expect(
      await resolveSeatMcpConfigForLaunch({
        directory: directory([]),
        backend: 'claude',
        userDataPath
      })
    ).toBeNull()
  })

  it('materialises the seat s own connectors for a supported backend', async () => {
    const resolved = await resolveSeatMcpConfigForLaunch({
      directory: directory([connector('usr_a', 'gdrive')]),
      backend: 'claude',
      userDataPath
    })
    expect(resolved).toContain('mcp.usr_a.json')
  })
})

describe('mergeSeatLaunchRestrictions', () => {
  it('carries a seat s config without turning the launch into a restricted one', () => {
    expect(mergeSeatLaunchRestrictions(null, null)).toBeNull()
    expect(mergeSeatLaunchRestrictions(null, '/tmp/mcp.json')).toEqual({
      mcpConfigPath: '/tmp/mcp.json'
    })
    expect(
      mergeSeatLaunchRestrictions(
        { role: 'lead', restrictions: { disallowedTools: ['Write'], env: {} } },
        '/tmp/m.json'
      )
    ).toEqual({ disallowedTools: ['Write'], env: {}, mcpConfigPath: '/tmp/m.json' })
  })
})

describe('appendSeatMcpConfigLaunchArgs', () => {
  it('quotes the path, and withholds the flag when there is nothing to point at', () => {
    expect(appendSeatMcpConfigLaunchArgs('--foo', '/tmp/a b/mcp.json')).toBe(
      "--foo --mcp-config '/tmp/a b/mcp.json'"
    )
    expect(appendSeatMcpConfigLaunchArgs(null, '/tmp/mcp.json')).toBe(
      "--mcp-config '/tmp/mcp.json'"
    )
    expect(appendSeatMcpConfigLaunchArgs('--foo', undefined)).toBe('--foo')
    expect(appendSeatMcpConfigLaunchArgs('--foo', "/tmp/it's/mcp.json")).toBe('--foo')
  })
})
