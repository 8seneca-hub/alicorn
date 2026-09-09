import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue,
  WINDOWS_HOOK_STDIN_DRAIN_COMMAND
} from '../agent-hooks/hook-stdin-contract'
import { buildWindowsAgentHookPostCommand } from '../agent-hooks/installer-utils'
import { ANTIGRAVITY_PRE_TOOL_USE_DECISION } from './hook-events'

// Why (#15117): PowerShell cost ~300ms of startup per event, which is what made the console
// the agent allocates for each hook last long enough to see.
const WINDOWS_ANTIGRAVITY_HOOK_POST_COMMAND = buildWindowsAgentHookPostCommand('antigravity', [
  // Why: Antigravity alone takes its event name from the wrapper's env, not the piped payload.
  '  --data-urlencode "hook_event_name=%ALICORN_ANTIGRAVITY_EVENT%" ^'
])

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      // Why (#9358/#9941): inherited delayed expansion eats `!` out of the percent-expanded
      // curl args, mangling paneKey and dropping worktreeId. `!` is legal in a Windows path.
      'setlocal DisableDelayedExpansion',
      'if /I "%ALICORN_ANTIGRAVITY_EVENT%"=="Stop" (',
      '  echo {"decision":""}',
      ') else if /I "%ALICORN_ANTIGRAVITY_EVENT%"=="PreToolUse" (',
      `  echo ${ANTIGRAVITY_PRE_TOOL_USE_DECISION}`,
      ') else (',
      '  echo {}',
      ')',
      'if defined ALICORN_AGENT_HOOK_ENDPOINT if exist "%ALICORN_AGENT_HOOK_ENDPOINT%" call "%ALICORN_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      WINDOWS_ANTIGRAVITY_HOOK_POST_COMMAND,
      'exit /b 0',
      ...buildWindowsHookStdinDrainEpilogue(),
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    'case "$ALICORN_ANTIGRAVITY_EVENT" in',
    '  Stop)',
    '    printf \'{"decision":""}\\n\'',
    '    ;;',
    '  PreToolUse)',
    `    printf '${ANTIGRAVITY_PRE_TOOL_USE_DECISION}\\n'`,
    '    ;;',
    '  *)',
    // Why: Antigravity accepts an empty JSON object for passive status hooks;
    // only the PreToolUse gate rejects it, and that branch answers above.
    '    printf "{}\\n"',
    '    ;;',
    'esac',
    // Why: some Antigravity events arrive without stdin but still need a
    // status post, so the shared capture maps empty input to an object.
    ...buildPosixHookPayloadCapture('empty-object'),
    ...buildPosixHookSpoolLines('antigravity', 'ALICORN_ANTIGRAVITY_EVENT'),
    'if [ -n "$ALICORN_AGENT_HOOK_ENDPOINT" ] && [ -r "$ALICORN_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ALICORN_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ALICORN_AGENT_HOOK_PORT" ] || [ -z "$ALICORN_AGENT_HOOK_TOKEN" ] || [ -z "$ALICORN_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Timeout caps best-effort hook posts if the local listener stalls.
    // Why: pipe payload to curl's stdin (`payload@-`) instead of an inline
    // `payload=$VALUE` arg, so tens-of-KB tool output stays off the curl
    // command line (EDR command-line false positives). Wire body is identical.
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${ALICORN_AGENT_HOOK_PORT}/hook/antigravity" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${ALICORN_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${ALICORN_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${ALICORN_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${ALICORN_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${ALICORN_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${ALICORN_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${ALICORN_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "hook_event_name=${ALICORN_ANTIGRAVITY_EVENT}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}

export function getWindowsWrapperScript(eventName: string): string {
  return [
    '@echo off',
    'setlocal',
    `set "ALICORN_ANTIGRAVITY_EVENT=${eventName}"`,
    'set "ALICORN_ANTIGRAVITY_CORE=%~dp0antigravity-hook.cmd"',
    'if exist "%ALICORN_ANTIGRAVITY_CORE%" (',
    '  call "%ALICORN_ANTIGRAVITY_CORE%"',
    '  exit /b 0',
    ')',
    'if /I "%ALICORN_ANTIGRAVITY_EVENT%"=="Stop" (',
    '  echo {"decision":""}',
    ') else if /I "%ALICORN_ANTIGRAVITY_EVENT%"=="PreToolUse" (',
    `  echo ${ANTIGRAVITY_PRE_TOOL_USE_DECISION}`,
    ') else (',
    '  echo {}',
    ')',
    // Why: when the shared core script is missing, this wrapper becomes the
    // stdin owner and must finish the agent's payload write before returning.
    WINDOWS_HOOK_STDIN_DRAIN_COMMAND,
    'exit /b 0',
    ''
  ].join('\r\n')
}
