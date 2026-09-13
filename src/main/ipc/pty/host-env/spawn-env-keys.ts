import { withLegacyEnvKeys } from '../../../../shared/alicorn-env-compat'

// Why both spellings: what gets deleted here is a value a *previous* build exported, and
// before R4 every one of these was spelled `ORCA_`.
export const AGENT_HOOK_RUNTIME_ENV_KEYS = withLegacyEnvKeys([
  'ALICORN_AGENT_HOOK_PORT',
  'ALICORN_AGENT_HOOK_TOKEN',
  'ALICORN_AGENT_HOOK_ENV',
  'ALICORN_AGENT_HOOK_VERSION',
  'ALICORN_AGENT_HOOK_TRANSPORT',
  'ALICORN_AGENT_HOOK_ENDPOINT',
  // Why: PR 2778 briefly exported this path; keep deleting stale inherited values so older PTYs can't leak the reverted path.
  'ALICORN_CLAUDE_AGENT_STATUS_SETTINGS'
])

// Why: Alicorn never sets these, so an inherited value means a pty host launched from inside a Claude session — Claude reads it as a nested child and silently stops persisting the transcript.
export const CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID'
] as const
