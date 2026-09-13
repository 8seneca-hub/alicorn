/** The command Alicorn installs on PATH, per platform. */
export function getAlicornCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    // Why `-ide`: Ubuntu ships GNOME Orca as /usr/bin/orca; the `-ide` suffix predates the
    // rebrand and stays so AppImage/deb/rpm naming does not move again.
    return 'alicorn-ide'
  }
  if (platform === 'win32') {
    return 'alicorn.cmd'
  }
  return 'alicorn'
}

/** The pre-rebrand command name. Still shipped and still on existing users' PATH for one
 *  release, so PATH probes fall back to it rather than reporting the CLI missing. */
export function getLegacyOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'orca-ide'
  }
  if (platform === 'win32') {
    return 'orca.cmd'
  }
  return 'orca'
}

/** The dev-mode command name, installed by `pnpm run build:cli` (bin, symlink and pane wrapper). */
export const ALICORN_DEV_CLI_COMMAND = 'alicorn-dev'

/** Its pre-rename handle, installed alongside for one release. */
export const LEGACY_ORCA_DEV_CLI_COMMAND = 'orca-dev'

/**
 * Both dev command names, preferred first.
 *
 * Why a list and not a constant at the call sites that probe disk or PATH: a dev profile
 * built by the previous release has only the old wrapper in `<userData>/cli/bin`, and a
 * launcher that resolves nothing there falls back to a *production* Alicorn — the one failure
 * this whole dev handle exists to avoid.
 */
export const DEV_CLI_COMMAND_NAMES = [ALICORN_DEV_CLI_COMMAND, LEGACY_ORCA_DEV_CLI_COMMAND] as const
