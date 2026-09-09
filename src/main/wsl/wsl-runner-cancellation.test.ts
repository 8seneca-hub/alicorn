import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

/**
 * Cancellation, proven against a real spawned process rather than a mock.
 *
 * The sibling suite (wsl-runner.test.ts) mocks `runProcess`, so it can only show
 * that `spec.signal` reaches the call -- and a suite that asserts nothing more
 * than "the promise settled" passes just as happily when the child is left
 * running. That is the failure this ticket is about: before `WslSpec` carried a
 * signal, the verification worker's row timeout settled its own promise and
 * orphaned `wsl.exe`.
 *
 * So this file lets the real `runProcess` spawn, and asserts on the *process*:
 * the recorded pid must be gone afterwards.
 *
 * What the stand-in can and cannot model. `wsl.exe` is the root process; the
 * Linux process lives inside the distro and is torn down by the WSL service
 * when its relay dies. Nothing on macOS reproduces that hop, so the fake below
 * `exec`s the guest argv in place -- the guest and the root are one pid, which
 * is the closest faithful analogue and keeps the assertion honest. Guest-side
 * teardown across a real relay stays uncovered; see wsl-runner.wsl.test.ts,
 * which is gated to win32 plus ALICORN_REAL_WSL_RUNNER_TEST.
 */

let fakeWslPath = ''
let scratchDir = ''

vi.mock('./wsl-executable-path', () => ({
  resolveWslExecutablePath: () => fakeWslPath
}))

import { runWslProcess } from './wsl-runner'

// Drops the wsl-side argv (`-d <distro> --exec`) and becomes the guest command,
// so killing what Orca spawned is killing the "guest".
const FAKE_WSL = `#!/bin/sh
while [ $# -gt 0 ] && [ "$1" != "--exec" ]; do shift; done
[ $# -gt 0 ] && shift
exec "$@"
`

/** Records its own pid, then refuses to finish on its own. */
function guestScript(options: { ignoreSigterm: boolean }): string {
  return [
    options.ignoreSigterm ? "trap '' TERM;" : '',
    'printf %s "$$" > "$1";',
    'while :; do sleep 1; done'
  ].join('')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  scratchDir = await mkdtemp(path.join(tmpdir(), 'wsl-runner-cancel-'))
  fakeWslPath = path.join(scratchDir, 'fake-wsl.sh')
  await writeFile(fakeWslPath, FAKE_WSL, 'utf8')
  await chmod(fakeWslPath, 0o755)
})

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('aborting a WSL command', () => {
  it.each([
    { name: 'a guest that exits on SIGTERM', ignoreSigterm: false },
    // The one the promise cannot vouch for: SIGTERM is ignored, so only the
    // SIGKILL escalation actually reaps it. runProcess settles at the grace
    // deadline either way.
    { name: 'a guest that ignores SIGTERM', ignoreSigterm: true }
  ])(
    'kills the process, not just the promise, for $name',
    async ({ ignoreSigterm }) => {
      const marker = path.join(scratchDir, `pid-${ignoreSigterm ? 'stubborn' : 'cooperative'}`)
      const controller = new AbortController()
      const pending = runWslProcess({
        // 'none' keeps the login-PATH probe out of the way: it would run through
        // the same fake and has its own budget regardless.
        loginPath: 'none',
        script: guestScript({ ignoreSigterm }),
        args: [marker],
        // Far beyond the test's own patience, so a signal that goes nowhere shows
        // up as a hang rather than as a pass.
        timeoutMs: 120_000,
        signal: controller.signal
      })

      let pid = 0
      try {
        await expect
          .poll(() => readFile(marker, 'utf8').catch(() => ''), { timeout: 15_000 })
          .not.toBe('')
        pid = Number(await readFile(marker, 'utf8'))
        expect(pid).toBeGreaterThan(0)
        expect(isAlive(pid)).toBe(true)

        controller.abort()
        const result = await pending

        // Cancelled, not timed out -- the caller asked it to stop.
        expect(result.timedOut).toBe(false)
        // The assertion the ticket exists for.
        await expect.poll(() => isAlive(pid), { timeout: 15_000 }).toBe(false)
      } finally {
        controller.abort()
        await pending.catch(() => {})
        if (pid > 0 && isAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* already gone */
          }
        }
      }
    },
    60_000
  )
})
