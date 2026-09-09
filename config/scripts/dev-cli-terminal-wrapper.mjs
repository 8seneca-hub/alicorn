import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function escapeWindowsBatchValue(value) {
  // Why: cmd.exe expands %NAME% even inside quotes, so literal path percent signs must be doubled.
  return value.replaceAll('%', '%%')
}

// Both dev names are written for one release: a pane a developer opened before the rename, and
// any script of theirs, still types `orca-dev`.
export function prepareDevCliTerminalWrappers({
  repoRoot,
  userDataPath,
  electronExecutable,
  platform = process.platform
}) {
  const binDir = path.join(repoRoot, 'out', 'bin')
  const userDataBinDir = path.join(userDataPath, 'cli', 'bin')
  const cliPath = path.join(repoRoot, 'out', 'cli', 'index.js')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(userDataBinDir, { recursive: true })

  if (platform === 'win32') {
    const wrapperContent = `@echo off\r\nset "ALICORN_USER_DATA_PATH=${escapeWindowsBatchValue(userDataPath)}"\r\nset "ALICORN_DEV_CLI_INVOCATION=1"\r\nset "ALICORN_APP_EXECUTABLE=${escapeWindowsBatchValue(electronExecutable)}"\r\nset "ALICORN_APP_EXECUTABLE_NEEDS_APP_ROOT=1"\r\nnode "${escapeWindowsBatchValue(cliPath)}" %*\r\n`
    for (const targetDir of [binDir, userDataBinDir]) {
      for (const commandName of ['alicorn-dev.cmd', 'orca-dev.cmd', 'alicorn.cmd', 'orca.cmd']) {
        writeFileSync(path.join(targetDir, commandName), wrapperContent, 'utf8')
      }
    }
  } else {
    const wrapperContent = `#!/usr/bin/env bash\nexport ALICORN_USER_DATA_PATH=${JSON.stringify(userDataPath)}\nexport ALICORN_DEV_CLI_INVOCATION=1\nexport ALICORN_APP_EXECUTABLE=${JSON.stringify(electronExecutable)}\nexport ALICORN_APP_EXECUTABLE_NEEDS_APP_ROOT=1\nexec node ${JSON.stringify(cliPath)} "$@"\n`
    for (const targetDir of [binDir, userDataBinDir]) {
      for (const commandName of ['alicorn-dev', 'orca-dev', 'alicorn', 'orca']) {
        const wrapperPath = path.join(targetDir, commandName)
        writeFileSync(wrapperPath, wrapperContent, 'utf8')
        chmodSync(wrapperPath, 0o755)
      }
    }
  }

  return { binDir, userDataBinDir }
}
