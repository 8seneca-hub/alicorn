import { basename } from 'node:path'
import {
  buildManagedCommandHook,
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  MANAGED_HOOK_TIMEOUT_SECONDS,
  quotePowerShellString,
  wrapWindowsPowerShellEncodedCommand,
  type HookCommandConfig
} from '../../agent-hooks/installer-utils'
import { wrapRuntimeHomeHookCommand } from '../../agent-hooks/runtime-home-hook-command'
import { CLAUDE_HOOK_SETTINGS, type ClaudeCompatibleHookSettings } from '../../claude/hook-settings'
import { ALICORN_ROLE_ENV_VAR } from './lead-tool-gate-script'

/**
 * Named per agent, like the statusline script: every file in `~/.orca/agent-hooks` is owned by the
 * refresher for the agent its name starts with, and a ratchet test fails on one that is not.
 */
export function getLeadToolGateScriptBaseName(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): string {
  return settings.scriptBaseName.replace(/-hook$/, '-lead-gate')
}

export function getLeadToolGateScriptFileName(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): string {
  return process.platform === 'win32'
    ? `${getLeadToolGateScriptBaseName(settings)}.cmd`
    : getPosixLeadToolGateScriptFileName(settings)
}

export function getPosixLeadToolGateScriptFileName(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): string {
  return `${getLeadToolGateScriptBaseName(settings)}.sh`
}

export function getLeadToolGateScriptPath(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): string {
  return getSharedManagedScriptPath(getLeadToolGateScriptFileName(settings))
}

/** Sweeps the gate entry across platforms and past installs, script-file name being the identity. */
export function createLeadToolGateMatcher(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): (command: string | undefined) => boolean {
  return createManagedCommandMatcher(getPosixLeadToolGateScriptFileName(settings))
}

/**
 * The `PreToolUse` entry installed alongside the status hook — a second definition in the same
 * bucket, never a replacement: the two answer different questions and Claude runs both.
 *
 * Guarded on `ALICORN_ROLE`, so a session that is not a lead answers without spawning anything.
 */
export function getLeadToolGateHook(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): HookCommandConfig {
  if (process.platform !== 'win32' || !settings.usesWindowsPowerShellLauncher) {
    return getRemoteLeadToolGateHook(settings)
  }
  return getWindowsLeadToolGateHook(getLeadToolGateScriptPath(settings))
}

/** Mirrors `getWindowsManagedLifecycleHook`: some Claude-compatible consumers ignore `args`. */
export function getWindowsLeadToolGateHook(scriptPath: string): HookCommandConfig {
  const quotedRelativePath = quotePowerShellString(`.orca\\agent-hooks\\${basename(scriptPath)}`)
  // Why the env test first: outside a lead pane there is nothing to decide, and #11549's rule is
  // that a hook answers before it owns stdin when its context is absent.
  const innerCommand =
    `if (-not $env:${ALICORN_ROLE_ENV_VAR}) { Write-Output '{}'; exit 0 }; ` +
    `$scriptPath = Join-Path $env:USERPROFILE ${quotedRelativePath}; ` +
    'if (Test-Path -LiteralPath $scriptPath -PathType Leaf) { & $scriptPath; exit $LASTEXITCODE }; ' +
    "[Console]::In.ReadToEnd() | Out-Null; Write-Output '{}'; exit 0"
  return {
    type: 'command',
    command: wrapWindowsPowerShellEncodedCommand(innerCommand),
    timeout: MANAGED_HOOK_TIMEOUT_SECONDS
  }
}

export function getRemoteLeadToolGateHook(
  settings: ClaudeCompatibleHookSettings = CLAUDE_HOOK_SETTINGS
): HookCommandConfig {
  return buildManagedCommandHook(
    wrapRuntimeHomeHookCommand(getLeadToolGateScriptBaseName(settings), {
      neutralJsonWhenMissing: true,
      requiredEnvVar: ALICORN_ROLE_ENV_VAR
    })
  )
}
