import { withLegacyEnvAliases, withLegacyEnvKeys } from '../../shared/alicorn-env-compat'
import {
  ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV
} from '../../shared/orchestration-compatibility-evidence'
import {
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { getShellReadyWrapperRoot } from '../providers/local-pty-shell-ready-wrapper-root'

const WSLENV_ENTRY_SEPARATOR = ':'

function parseWslenvEntries(value: string | undefined): string[] {
  return value ? value.split(WSLENV_ENTRY_SEPARATOR).filter(Boolean) : []
}

function upsertWslenvEntry(entries: string[], entry: string): void {
  const variableName = entry.split('/')[0]
  const existingIndex = entries.findIndex((value) => value.split('/')[0] === variableName)
  if (existingIndex === -1) {
    entries.push(entry)
    return
  }
  entries[existingIndex] = entry
}

function applyWslenvPassthrough(
  env: Record<string, string | undefined>,
  passthroughEntries: string[]
): void {
  const entries = parseWslenvEntries(env.WSLENV)
  for (const entry of passthroughEntries) {
    const variableName = entry.split('/')[0]
    if (env[variableName]) {
      upsertWslenvEntry(entries, entry)
    }
  }
  env.WSLENV = entries.join(WSLENV_ENTRY_SEPARATOR)
}

function worktreeSetupWslenvEntries(env: Record<string, string | undefined>): string[] {
  return [
    // Setup/hook scripts read these (#9206). A pre-translated Linux value must
    // cross untranslated (/u); a raw C:\ path still needs WSLENV to convert it (/p).
    ...[
      'ALICORN_ROOT_PATH',
      'ALICORN_WORKTREE_PATH',
      'CONDUCTOR_ROOT_PATH',
      'GHOSTX_ROOT_PATH'
    ].map((name) => `${name}/${env[name]?.startsWith('/') ? 'u' : 'p'}`),
    // A display name, never a path.
    'ALICORN_WORKSPACE_NAME/u'
  ]
}

export function addOrcaWslInteropEnv(env: Record<string, string>): void {
  // Why set here: every WSL spawn path funnels through this helper, and the
  // in-guest login script needs the resolved wrapper root. Windows/WSL wrappers
  // are always the local file set -- windows-shell-args.ts is shared by the
  // in-process provider and the daemon spawner, so both resolve the same tree.
  env.ALICORN_SHELL_READY_ROOT = getShellReadyWrapperRoot()
  // Why: the endpoint is a Windows path (/p-translated so the guest reads it
  // via /mnt/c) until the WSL hook relay reports the guest home — then it is
  // already a guest-side POSIX path and must cross untranslated.
  const endpointFlag = env.ALICORN_AGENT_HOOK_ENDPOINT?.startsWith('/') ? 'u' : 'p'
  // Why: ONLY a guest-side POSIX overlay may cross. /p would path-translate a
  // Windows value into /mnt/c and let in-guest OpenCode adopt it as its config
  // root — reachable via the relay spawn's process.env (wsl-hook-relay-launch)
  // and via daemon-inherited env, which buildPtyHostEnv's delete cannot reach.
  const opencodeOverlayEntries = (['OPENCODE_CONFIG_DIR', 'ALICORN_OPENCODE_CONFIG_DIR'] as const)
    .filter((name) => env[name]?.startsWith('/'))
    .map((name) => `${name}/u`)
  // Why: wsl.exe only imports selected Windows env vars, so WSL needs the wrapper root, pane identity, and hook/OMP coordinates at start.
  const passthroughEntries = [
    'ALICORN_TERMINAL_HANDLE/u',
    'ALICORN_USER_DATA_PATH/p',
    // Why /p: the guest reads the content-addressed wrapper tree through /mnt/c,
    // and it cannot derive the hash segment from ALICORN_USER_DATA_PATH alone.
    'ALICORN_SHELL_READY_ROOT/p',
    'ALICORN_CLI_COMMAND/u',
    'ALICORN_CODEX_LAUNCH_PREFLIGHT/p',
    'ALICORN_PANE_KEY/u',
    'ALICORN_TAB_ID/u',
    'ALICORN_WORKTREE_ID/u',
    'ALICORN_AGENT_LAUNCH_TOKEN/u',
    `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
    `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`,
    'ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u',
    'ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_ID/u',
    'ALICORN_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u',
    'ALICORN_AGENT_HOOK_PORT/u',
    'ALICORN_AGENT_HOOK_TOKEN/u',
    'ALICORN_AGENT_HOOK_ENV/u',
    'ALICORN_AGENT_HOOK_VERSION/u',
    'ALICORN_AGENT_HOOK_TRANSPORT/u',
    `ALICORN_AGENT_HOOK_ENDPOINT/${endpointFlag}`,
    ...opencodeOverlayEntries,
    'ALICORN_WSL_HOOK_RELAY_VERSION/u',
    'ALICORN_WSL_HOOK_INSTANCE/u',
    'ALICORN_OMP_SOURCE_AGENT_DIR/p',
    'ALICORN_OMP_STATUS_EXTENSION/p',
    ...worktreeSetupWslenvEntries(env)
  ]
  // Why here and not at the PTY env choke point: wsl.exe imports only what WSLENV names, so
  // an in-guest hook script or wrapper left by the previous release sees nothing at all unless
  // the pre-rebrand spelling crosses the boundary too. Alias first — an entry is only emitted
  // for a variable that is actually set.
  Object.assign(env, withLegacyEnvAliases(env))
  applyWslenvPassthrough(env, withLegacyWslenvEntries(passthroughEntries))
}

/** Each entry plus its pre-rebrand twin, keeping that entry's own `/u` or `/p` flag. */
function withLegacyWslenvEntries(entries: readonly string[]): string[] {
  return entries.flatMap((entry) => {
    const [name, ...flag] = entry.split('/')
    return withLegacyEnvKeys([name]).map((key) => [key, ...flag].join('/'))
  })
}

export function stampWslOrchestrationCompatibilityHost(
  env: Record<string, string>,
  hostId: string | null | undefined,
  distro: string | null | undefined
): void {
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV]
  const normalizedHostId = hostId?.trim()
  const normalizedDistro = distro?.trim()
  if (!normalizedHostId || !normalizedDistro) {
    return
  }
  env[ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV] = 'wsl'
  env[ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV] = normalizedHostId
  env[ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV] = normalizedDistro
}
