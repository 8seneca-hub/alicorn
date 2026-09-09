#!/usr/bin/env node
// Symlinks the alicorn-dev wrapper into /usr/local/bin so the dev CLI is
// available globally after `pnpm run build:cli`.
//
// Both names are installed for one release. A developer whose shell history, tmux layout or
// half-written script still says `orca-dev` must not get "command not found" mid-session, and
// the dev handle costs nothing to keep — unlike the production shim, it never reaches a user.
import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const scriptDir = import.meta.dirname
const source = path.join(scriptDir, 'alicorn-dev.mjs')

const COMMAND_NAMES = ['alicorn-dev', 'orca-dev']

if (process.platform !== 'darwin' && process.platform !== 'linux') {
  console.log('[alicorn-dev] Skipping global symlink (unsupported platform).')
  process.exit(0)
}

function isOwnedByUs(target) {
  try {
    if (!lstatSync(target).isSymbolicLink()) {
      return false
    }
    return readlinkSync(target) === source
  } catch {
    return false
  }
}

/** Why not exit on the first name: the alias failing must not stop the real one installing. */
function linkCommand(commandName) {
  const commandPath = `/usr/local/bin/${commandName}`
  if (existsSync(commandPath)) {
    if (isOwnedByUs(commandPath)) {
      console.log(`[alicorn-dev] ${commandPath} already points to dev CLI.`)
      return
    }
    // A stale `orca-dev` symlink pointing at the pre-rename wrapper path lands here, and
    // repointing someone's /usr/local/bin without asking is not ours to do.
    console.error(
      `[alicorn-dev] ${commandPath} exists but is not our symlink. Remove it manually if you want the dev CLI installed globally.`
    )
    return
  }

  try {
    execFileSync('ln', ['-s', source, commandPath], { stdio: 'inherit' })
    console.log(`[alicorn-dev] Symlinked ${commandPath} → ${source}`)
  } catch {
    console.log(
      `[alicorn-dev] Could not create ${commandPath} (permission denied). Run once with:\n` +
        `  sudo ln -s ${source} ${commandPath}`
    )
  }
}

for (const commandName of COMMAND_NAMES) {
  linkCommand(commandName)
}
