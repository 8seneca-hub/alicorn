/**
 * R4 Task 8. After the `ORCA_*` → `ALICORN_*` rename, a hook script installed by the previous
 * release is still on disk on every host this machine talks to — local, each WSL distro, each
 * SSH connection.
 *
 * **Staleness is decided by content, not by a version number.** A v1 script reads the old env
 * names, so the bytes we would write today differ from the bytes on disk — which is what
 * `writeManagedScript` and `writeManagedScriptRemote` already compare before rewriting. The
 * version a hook *posts* at runtime cannot answer this: it reads that from the endpoint file,
 * which now carries both env spellings, so a v1 script reports v2 exactly like a current one.
 * The protocol bump made a stale endpoint file detectable; it never made a stale script
 * detectable. This sweep exposes the comparison the installers were already making and throwing
 * away.
 *
 * The reason it is a sweep and not a log line is the third outcome. A host we cannot reach is
 * `unreachable`, never `current`: loss of contact is not evidence that anything is installed,
 * and reporting it as done is how a stale hook survives the upgrade meant to replace it
 * (`docs/reference/ssh-execution-boundary.md` makes the same rule for liveness).
 */

export type HookReinstallHost =
  | { kind: 'local' }
  | { kind: 'wsl'; distro: string }
  | { kind: 'ssh'; connectionId: string }

export type HookReinstallStatus = 'reinstalled' | 'current' | 'unreachable'

export type HookReinstallOutcome = {
  host: HookReinstallHost
  status: HookReinstallStatus
  /** Why the host is unreachable. Absent for the other two. */
  detail?: string
}

/** What a host's installers did: at least one script rewritten, or every one already current. */
export type HookReinstallEffect = 'written' | 'unchanged'

export type HookReinstallSweepInput = {
  hosts: readonly HookReinstallHost[]
  /**
   * Run this host's managed hook installers and report whether anything was rewritten.
   *
   * Throwing is the honest way to say "could not reach it" — a partial install that left the old
   * script in place must throw rather than return `unchanged`, which means current.
   */
  reinstall: (host: HookReinstallHost) => Promise<HookReinstallEffect>
}

export function describeHookReinstallHost(host: HookReinstallHost): string {
  switch (host.kind) {
    case 'local':
      return 'local'
    case 'wsl':
      return `wsl:${host.distro}`
    case 'ssh':
      return `ssh:${host.connectionId}`
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Sweep every host, in order, and report one outcome each.
 *
 * Sequential on purpose: SSH hosts share a session budget (`isSshSessionLimitError` exists
 * because we have exhausted it before), and a sweep that opens every connection at once to save
 * a few seconds at startup is the kind of thing that only fails on the machine with fifteen
 * remotes configured. Timeouts belong to the injected `reinstall`, which owns the transport.
 *
 * Never throws: one host's failure is that host's outcome, not the sweep's.
 */
export async function sweepHookReinstall(
  input: HookReinstallSweepInput
): Promise<HookReinstallOutcome[]> {
  const outcomes: HookReinstallOutcome[] = []
  for (const host of input.hosts) {
    try {
      const effect = await input.reinstall(host)
      outcomes.push({ host, status: effect === 'written' ? 'reinstalled' : 'current' })
    } catch (error) {
      outcomes.push({ host, status: 'unreachable', detail: errorDetail(error) })
    }
  }
  return outcomes
}

/** The hosts an operator needs to be told about: stale hooks nobody could replace. */
export function unreachableHookHosts(outcomes: readonly HookReinstallOutcome[]): string[] {
  return outcomes
    .filter((outcome) => outcome.status === 'unreachable')
    .map((outcome) =>
      outcome.detail
        ? `${describeHookReinstallHost(outcome.host)} (${outcome.detail})`
        : describeHookReinstallHost(outcome.host)
    )
}

/** Fold a host's per-script results into one effect: any rewrite makes the host reinstalled. */
export function combineHookReinstallEffects(
  effects: readonly HookReinstallEffect[]
): HookReinstallEffect {
  return effects.includes('written') ? 'written' : 'unchanged'
}
