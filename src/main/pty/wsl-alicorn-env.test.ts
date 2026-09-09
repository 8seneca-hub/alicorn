import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { getShellReadyWrapperRoot } from '../providers/local-pty-shell-ready-wrapper-root'
import {
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { addOrcaWslInteropEnv, stampWslOrchestrationCompatibilityHost } from './wsl-alicorn-env'

describe('addOrcaWslInteropEnv', () => {
  // Every entry crosses twice this release: an in-guest hook or wrapper left by the previous
  // release reads `ORCA_*`, and wsl.exe imports only what WSLENV names.

  it('marks the Orca terminal handle for Windows to WSL env import', () => {
    const env: Record<string, string> = { ALICORN_TERMINAL_HANDLE: 'term_wsl' }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toBe(
      'ALICORN_TERMINAL_HANDLE/u:ORCA_TERMINAL_HANDLE/u:ALICORN_SHELL_READY_ROOT/p:ORCA_SHELL_READY_ROOT/p'
    )
  })

  // Why this is published at all: the wrapper tree is content-addressed, so the
  // in-guest login script cannot rebuild its path from ALICORN_USER_DATA_PATH -- it
  // cannot derive the hash segment. Without this the guest finds no wrapper and
  // every WSL pane launches unwrapped: no ready marker, so every startup command
  // waits out the full readiness timeout.
  it('publishes the resolved wrapper root path-translated for the guest', () => {
    const env: Record<string, string> = {}

    addOrcaWslInteropEnv(env)

    expect(env.ALICORN_SHELL_READY_ROOT).toBe(getShellReadyWrapperRoot())
    expect(isAbsolute(env.ALICORN_SHELL_READY_ROOT as string)).toBe(true)
    // /p, not /u: the guest reads a Windows path through /mnt/c.
    expect(env.WSLENV?.split(':')).toContain('ALICORN_SHELL_READY_ROOT/p')
  })

  it('imports setup-gated startup env into WSL without path translation', () => {
    const env: Record<string, string> = {
      [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: 'codex',
      [SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV]: 'while :; do sleep 1; done'
    }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV?.split(':')).toEqual([
      'ALICORN_SHELL_READY_ROOT/p',
      'ORCA_SHELL_READY_ROOT/p',
      `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
      'ORCA_SEQUENCED_STARTUP_COMMAND/u',
      `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`,
      'ORCA_SEQUENCED_STARTUP_SCRIPT/u'
    ])
  })

  it('preserves existing WSLENV entries and does not duplicate the handle entry', () => {
    const env: Record<string, string> = {
      WSLENV: 'FOO/u:ALICORN_TERMINAL_HANDLE/u:BAR/p'
    }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toBe(
      'FOO/u:ALICORN_TERMINAL_HANDLE/u:BAR/p:ALICORN_SHELL_READY_ROOT/p:ORCA_SHELL_READY_ROOT/p'
    )
  })

  it('marks OMP status and hook env for Windows to WSL import', () => {
    const env: Record<string, string> = {
      ALICORN_TERMINAL_HANDLE: 'term_wsl',
      ALICORN_USER_DATA_PATH: 'C:\\Users\\jin\\AppData\\Roaming\\Orca',
      ALICORN_CLI_COMMAND: 'orca-ide',
      ALICORN_CODEX_LAUNCH_PREFLIGHT: 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe',
      ALICORN_OMP_STATUS_EXTENSION: 'C:\\Users\\jin\\.omp\\agent\\extensions\\orca-agent-status.ts',
      ALICORN_PRIME_AGENT_STATUS_EXTENSION: 'C:\\stale\\orca-agent-status.ts',
      ALICORN_PANE_KEY: 'tab-1:leaf-1',
      ALICORN_TAB_ID: 'tab-1',
      ALICORN_WORKTREE_ID: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\jin\\repo',
      ALICORN_AGENT_LAUNCH_TOKEN: 'launch-secret',
      ALICORN_AGENT_HOOK_PORT: '4567',
      ALICORN_AGENT_HOOK_TOKEN: 'token',
      ALICORN_AGENT_HOOK_ENV: 'dev',
      ALICORN_AGENT_HOOK_VERSION: '1',
      ALICORN_AGENT_HOOK_TRANSPORT: 'raw-json-v1',
      ALICORN_WSL_HOOK_INSTANCE: 'testinstance',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toContain('ALICORN_TERMINAL_HANDLE/u')
    expect(env.WSLENV).toContain('ALICORN_USER_DATA_PATH/p')
    expect(env.WSLENV).toContain('ALICORN_CLI_COMMAND/u')
    expect(env.WSLENV).toContain('ALICORN_CODEX_LAUNCH_PREFLIGHT/p')
    expect(env.WSLENV).toContain('ALICORN_OMP_STATUS_EXTENSION/p')
    expect(env.WSLENV).not.toContain('ALICORN_PRIME_AGENT_STATUS_EXTENSION')
    expect(env.WSLENV).toContain('ALICORN_PANE_KEY/u')
    expect(env.WSLENV).toContain('ALICORN_TAB_ID/u')
    expect(env.WSLENV).toContain('ALICORN_WORKTREE_ID/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_LAUNCH_TOKEN/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_HOOK_PORT/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_HOOK_TOKEN/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_HOOK_ENV/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_HOOK_VERSION/u')
    expect(env.WSLENV).toContain('ALICORN_AGENT_HOOK_TRANSPORT/u')
    expect(env.WSLENV).toContain('ALICORN_WSL_HOOK_INSTANCE/u')
    expect(env.WSLENV).toContain('ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u')
    expect(env.WSLENV).toContain('ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID/u')
    expect(env.WSLENV).toContain('ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u')
  })

  it('overwrites caller host evidence with native runtime WSL authority', () => {
    const env = {
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      ALICORN_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', 'Ubuntu')

    expect(env).toEqual({
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    })
  })

  it('clears inherited host evidence outside a runtime-owned WSL scope', () => {
    const env = {
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      ALICORN_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', null)

    expect(env).toEqual({})
  })

  it('path-translates a Windows hook endpoint but passes a guest-side one untouched', () => {
    const windowsEnv: Record<string, string> = {
      ALICORN_AGENT_HOOK_ENDPOINT:
        'C:\\Users\\jin\\AppData\\Roaming\\Orca\\agent-hooks\\endpoint.cmd'
    }
    addOrcaWslInteropEnv(windowsEnv)
    expect(windowsEnv.WSLENV).toContain('ALICORN_AGENT_HOOK_ENDPOINT/p')

    const guestEnv: Record<string, string> = {
      ALICORN_AGENT_HOOK_ENDPOINT: '/home/jin/.orca-wsl/agent-hooks/port-4567/endpoint.env'
    }
    addOrcaWslInteropEnv(guestEnv)
    expect(guestEnv.WSLENV).toContain('ALICORN_AGENT_HOOK_ENDPOINT/u')
    expect(guestEnv.WSLENV).not.toContain('ALICORN_AGENT_HOOK_ENDPOINT/p')
  })

  it('tags pre-translated Linux setup paths /u so WSLENV does not translate them again (#9206)', () => {
    const env: Record<string, string> = {
      ALICORN_ROOT_PATH: '/home/jin/repo',
      ALICORN_WORKTREE_PATH: '/home/jin/repo-worktrees/fix-1',
      ALICORN_WORKSPACE_NAME: 'fix-1',
      CONDUCTOR_ROOT_PATH: '/home/jin/repo',
      GHOSTX_ROOT_PATH: '/home/jin/repo'
    }

    addOrcaWslInteropEnv(env)

    // /u (not /p): hooks.ts already converted these to Linux paths before
    // spawn, so a /p flag would make WSLENV double-translate them.
    expect(env.WSLENV).toContain('ALICORN_ROOT_PATH/u')
    expect(env.WSLENV).toContain('ALICORN_WORKTREE_PATH/u')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/u')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('ALICORN_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('ALICORN_WORKTREE_PATH/p')
    // The value itself must stay the already-Linux path.
    expect(env.ALICORN_ROOT_PATH).toBe('/home/jin/repo')
    expect(env.ALICORN_WORKTREE_PATH).toBe('/home/jin/repo-worktrees/fix-1')
  })

  it('tags untranslated Windows setup paths /p so WSLENV translates them (wsl.exe shell over a Windows worktree)', () => {
    const env: Record<string, string> = {
      ALICORN_ROOT_PATH: 'C:\\Users\\jin\\repo',
      ALICORN_WORKTREE_PATH: 'C:\\Users\\jin\\repo-worktrees\\fix-1',
      CONDUCTOR_ROOT_PATH: 'C:\\Users\\jin\\repo',
      GHOSTX_ROOT_PATH: 'C:\\Users\\jin\\repo'
    }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toContain('ALICORN_ROOT_PATH/p')
    expect(env.WSLENV).toContain('ALICORN_WORKTREE_PATH/p')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/p')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('ALICORN_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('ALICORN_WORKTREE_PATH/u')
  })

  it('always tags ALICORN_WORKSPACE_NAME /u because it is a name, not a path', () => {
    const env: Record<string, string> = { ALICORN_WORKSPACE_NAME: 'fix-1' }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toBe(
      'ALICORN_SHELL_READY_ROOT/p:ORCA_SHELL_READY_ROOT/p:ALICORN_WORKSPACE_NAME/u:ORCA_WORKSPACE_NAME/u'
    )
  })

  it('does not register setup vars that are absent from the env', () => {
    const env: Record<string, string> = { ALICORN_TERMINAL_HANDLE: 'term_wsl' }

    addOrcaWslInteropEnv(env)

    expect(env.WSLENV).toBe(
      'ALICORN_TERMINAL_HANDLE/u:ORCA_TERMINAL_HANDLE/u:ALICORN_SHELL_READY_ROOT/p:ORCA_SHELL_READY_ROOT/p'
    )
  })

  it('marks the WSL hook relay version for import on relay spawn envs', () => {
    const env: Record<string, string> = {
      ALICORN_WSL_HOOK_RELAY_VERSION: '0.1.0+abc'
    }
    addOrcaWslInteropEnv(env)
    expect(env.WSLENV).toBe(
      'ALICORN_SHELL_READY_ROOT/p:ORCA_SHELL_READY_ROOT/p:ALICORN_WSL_HOOK_RELAY_VERSION/u:ORCA_WSL_HOOK_RELAY_VERSION/u'
    )
  })

  it('crosses a guest-side OpenCode config overlay untranslated (/u)', () => {
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: '/home/jin/.orca-relay/opencode-overlays/abc',
      ALICORN_OPENCODE_CONFIG_DIR: '/home/jin/.orca-relay/opencode-overlays/abc'
    }
    addOrcaWslInteropEnv(env)
    expect(env.WSLENV).toContain('OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).toContain('ALICORN_OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR/p')
  })

  it('never crosses a Windows OpenCode config dir into the guest', () => {
    // Why: the relay spawn env spreads process.env and the daemon inherits its
    // own — a /p entry here would deliver C:\... as /mnt/c and in-guest OpenCode
    // would adopt Orca's Windows overlay as its config root.
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\Orca\\opencode-overlays\\abc',
      ALICORN_OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\Orca\\opencode-overlays\\abc'
    }
    addOrcaWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('ALICORN_OPENCODE_CONFIG_DIR')
  })

  it('does not register the OpenCode config vars when they are absent', () => {
    const env: Record<string, string> = { ALICORN_TERMINAL_HANDLE: 'term_wsl' }
    addOrcaWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('ALICORN_OPENCODE_CONFIG_DIR')
  })
})
