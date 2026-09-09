export const DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/alicorn'
export const DEV_COMMAND_NAME = 'orca-dev'
// Why: the bare `orca` name the Linux CLI used before it moved to `orca-ide`; still
// reclaimed on install so two generations of managed commands do not both sit on PATH.
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000
