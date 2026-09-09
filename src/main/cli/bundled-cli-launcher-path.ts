import { join } from 'node:path'

// Why `-ide` on Linux: GNOME Orca ships /usr/bin/orca, so the CLI never claimed that name;
// the suffix outlives the rebrand so AppImage/deb/rpm naming stays put.
export const LINUX_CLI_COMMAND_NAME = 'alicorn-ide'

/** The pre-rebrand Linux command. Still shipped beside the current one for one release so
 *  symlinks registered before the rename keep resolving. */
export const LEGACY_LINUX_PACKAGED_CLI_COMMAND_NAME = 'orca-ide'

/** Absolute path of the CLI launcher this app ships in its own resources bundle.
 *  Lives apart from cli-installer so callers that only need the path (PTY env
 *  assembly) don't pull in the installer's `electron` dependency. */
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'alicorn')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'alicorn.exe')
  }
  return null
}
