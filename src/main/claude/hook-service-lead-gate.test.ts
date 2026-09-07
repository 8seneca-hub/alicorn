import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as osModule from 'node:os'

let isolatedUserDataDir = ''
let previousUserDataPath: string | undefined
let home = ''

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-user-data' } }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>()
  return { ...actual, homedir: homedirMock.mockImplementation(actual.homedir) }
})

import { ClaudeHookService } from './hook-service'
import { OPENCLAUDE_HOOK_SETTINGS } from './hook-settings'
import {
  getLeadToolGateScriptFileName,
  getPosixLeadToolGateScriptFileName
} from '../alicorn/foreman/lead-tool-gate-hook'

type HookEntry = { hooks?: { command?: string }[] }

function readPreToolUse(agentDir = '.claude'): HookEntry[] {
  const settings: unknown = JSON.parse(readFileSync(join(home, agentDir, 'settings.json'), 'utf8'))
  const hooks = (settings as { hooks?: Record<string, HookEntry[]> }).hooks
  return hooks?.PreToolUse ?? []
}

function commandsIn(entries: HookEntry[]): string[] {
  return entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hook.command ?? ''))
}

beforeEach(() => {
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  isolatedUserDataDir = mkdtempSync(join(tmpdir(), 'orca-lead-gate-user-data-'))
  process.env.ORCA_USER_DATA_PATH = isolatedUserDataDir
  home = mkdtempSync(join(tmpdir(), 'orca-lead-gate-home-'))
  homedirMock.mockReturnValue(home)
})

afterEach(() => {
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  homedirMock.mockImplementation(() => process.env.HOME ?? tmpdir())
  rmSync(isolatedUserDataDir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('lead tool gate installation', () => {
  it('installs alongside the status hook rather than in place of it', () => {
    new ClaudeHookService().install()

    const commands = commandsIn(readPreToolUse())
    expect(commands).toHaveLength(2)
    expect(commands.some((command) => command.includes('claude-hook'))).toBe(true)
    expect(commands.some((command) => command.includes('claude-lead-gate'))).toBe(true)
  })

  it('writes the gate script next to the status script', () => {
    new ClaudeHookService().install()

    expect(existsSync(join(home, '.orca', 'agent-hooks', getLeadToolGateScriptFileName()))).toBe(
      true
    )
  })

  // Why: a session that is not a lead must answer without spawning the script at all.
  it('guards the entry on ALICORN_ROLE', () => {
    new ClaudeHookService().install()

    const gate = commandsIn(readPreToolUse()).find((command) =>
      command.includes('claude-lead-gate')
    )
    expect(gate).toContain('ALICORN_ROLE')
    expect(gate?.indexOf('ALICORN_ROLE')).toBeLessThan(gate?.indexOf('claude-lead-gate') ?? -1)
  })

  it('installs a second time without stacking duplicates', () => {
    const service = new ClaudeHookService()
    service.install()
    service.install()

    expect(commandsIn(readPreToolUse())).toHaveLength(2)
  })

  it('names the script for the agent that owns it', () => {
    expect(getPosixLeadToolGateScriptFileName()).toBe('claude-lead-gate.sh')
    expect(getPosixLeadToolGateScriptFileName(OPENCLAUDE_HOOK_SETTINGS)).toBe(
      'openclaude-lead-gate.sh'
    )
  })

  it('takes the gate back out on remove', () => {
    const service = new ClaudeHookService()
    service.install()
    service.remove()

    expect(commandsIn(readPreToolUse())).toHaveLength(0)
  })
})
