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
