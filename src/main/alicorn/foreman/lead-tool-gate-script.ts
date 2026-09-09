import { ALICORN_ROLE_ENV } from '../agent-pane-role'
import {
  buildPosixHookPayloadCapture,
  WINDOWS_HOOK_STDIN_DRAIN_COMMAND
} from '../../agent-hooks/hook-stdin-contract'

/** Where the running app answers a lead's tool call. Its own endpoint, so the status hook's
 *  fail-open `/hook/<source>` contract is untouched. */
export const ALICORN_LEAD_TOOL_GATE_PATHNAME = '/alicorn/lead-tool-gate'

/** Set on a restricted pane at launch; absent everywhere else, which is what keeps an ordinary
 *  session from spawning this hook at all. */
export const ALICORN_ROLE_ENV_VAR = ALICORN_ROLE_ENV

const CURL_FLAGS = [
  '--connect-timeout 0.5 --max-time 1.5',
  '--noproxy "127.0.0.1"',
  '-H "Content-Type: application/json"'
] as const

/**
 * The `PreToolUse` gate for a Foreman lead pane.
 *
 * Unlike the status hook, this one does not print neutral JSON up front: its answer *is* its
 * stdout, so every branch prints exactly once. Empty stdout fails closed in Claude (#14818), so
 * anything short of a decision — no app, no curl, a timeout, a 204 — must still print `{}`.
 *
 * The cwd travels as a header as well as in the payload: it is the worktree the lead must not
 * read, and a gate that cannot locate the worktree fails open.
 */
export function getLeadToolGateScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: refresh endpoint coordinates for PTYs surviving an Orca restart — a stale port
      // would silently leave the lead unrestricted.
      'if defined ALICORN_AGENT_HOOK_ENDPOINT if exist "%ALICORN_AGENT_HOOK_ENDPOINT%" call "%ALICORN_AGENT_HOOK_ENDPOINT%" 2>nul',
      // Why (#11549): outside an Orca pane the caller may abandon stdin, so answer without
      // reading it; in a pane, a non-lead drains as usual.
      'if "%ALICORN_AGENT_HOOK_PORT%"=="" goto :orca_lead_gate_neutral',
      'if "%ALICORN_AGENT_HOOK_TOKEN%"=="" goto :orca_lead_gate_neutral',
      `if "%${ALICORN_ROLE_ENV_VAR}%"=="" goto :orca_lead_gate_drain`,
      'set "ALICORN_LEAD_GATE_OUT=%TEMP%\\orca-lead-gate-%RANDOM%%RANDOM%.json"',
      // Why a response file rather than a captured pipe: `for /f` re-runs the command in a
      // subshell that does not inherit this hook's stdin, which is the payload.
      [
        '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
        `"http://127.0.0.1:%ALICORN_AGENT_HOOK_PORT%${ALICORN_LEAD_TOOL_GATE_PATHNAME}"`,
        ...CURL_FLAGS,
        '-H "X-Orca-Agent-Hook-Token: %ALICORN_AGENT_HOOK_TOKEN%"',
        `-H "X-Alicorn-Role: %${ALICORN_ROLE_ENV_VAR}%"`,
        '-H "X-Alicorn-Cwd: %CD%"',
        '--data-binary @-',
        '-o "%ALICORN_LEAD_GATE_OUT%" >nul 2>&1'
      ].join(' '),
      'findstr /b /c:"{" "%ALICORN_LEAD_GATE_OUT%" >nul 2>&1 && (type "%ALICORN_LEAD_GATE_OUT%") || (echo {})',
      'del /f /q "%ALICORN_LEAD_GATE_OUT%" >nul 2>&1',
      'exit /b 0',
      ':orca_lead_gate_drain',
      WINDOWS_HOOK_STDIN_DRAIN_COMMAND,
      ':orca_lead_gate_neutral',
      'echo {}',
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Why capture first (#8110): every POSIX managed hook owns stdin before it can exit, or the
    // agent sees a broken pipe mid-write. It also means the guards below need no drain.
    ...buildPosixHookPayloadCapture('empty-object'),
    // Why: refresh endpoint coordinates for PTYs surviving an Orca restart — a stale port would
    // silently leave the lead unrestricted.
    'if [ -n "${ALICORN_AGENT_HOOK_ENDPOINT:-}" ] && [ -r "$ALICORN_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ALICORN_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    `if [ -z "\${${ALICORN_ROLE_ENV_VAR}:-}" ] || [ -z "\${ALICORN_AGENT_HOOK_PORT:-}" ] || [ -z "\${ALICORN_AGENT_HOOK_TOKEN:-}" ]; then`,
    "  printf '{}\\n'",
    '  exit 0',
    'fi',
    [
      'orca_lead_gate=$(printf %s "$payload" | curl -sS -X POST',
      `"http://127.0.0.1:\${ALICORN_AGENT_HOOK_PORT}${ALICORN_LEAD_TOOL_GATE_PATHNAME}"`,
      ...CURL_FLAGS,
      '-H "X-Orca-Agent-Hook-Token: ${ALICORN_AGENT_HOOK_TOKEN}"',
      `-H "X-Alicorn-Role: \${${ALICORN_ROLE_ENV_VAR}}"`,
      '-H "X-Alicorn-Cwd: ${PWD:-}"',
      '--data-binary @- 2>/dev/null) || orca_lead_gate=""'
    ].join(' '),
    // Why the shape check: only a JSON object is a decision. Anything else — an error page, a
    // truncated body, nothing at all — must read as "no decision", never as empty stdout.
    'case "$orca_lead_gate" in',
    "  '{'*) printf '%s\\n' \"$orca_lead_gate\" ;;",
    "  *) printf '{}\\n' ;;",
    'esac',
    'exit 0',
    ''
  ].join('\n')
}
