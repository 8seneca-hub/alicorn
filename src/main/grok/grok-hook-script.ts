import {
  getSharedManagedScriptPath,
  wrapPosixHookCommand,
  wrapWindowsCmdHookCommand
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines
} from '../agent-hooks/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  // A cmd-safe bare path avoids two extra Windows interpreters; POSIX can gate before spawning the
  // managed script because Alicorn injects ALICORN_PANE_KEY only into panes it owns.
  return process.platform === 'win32'
    ? wrapWindowsCmdHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath, {}, { requiredEnvVar: 'ALICORN_PANE_KEY' })
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$ALICORN_AGENT_HOOK_ENDPOINT" ] && [ -r "$ALICORN_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ALICORN_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ALICORN_AGENT_HOOK_PORT" ] || [ -z "$ALICORN_AGENT_HOOK_TOKEN" ] || [ -z "$ALICORN_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${ALICORN_AGENT_HOOK_PORT}/hook/grok" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${ALICORN_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${ALICORN_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${ALICORN_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${ALICORN_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${ALICORN_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${ALICORN_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${ALICORN_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
