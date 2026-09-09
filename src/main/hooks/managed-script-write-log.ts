/**
 * What the managed-script writers did, so the hook reinstall sweep can say whether a host was
 * already current or had a pre-rename script replaced.
 *
 * Why a log rather than a return value: three writers make this decision
 * (`writeManagedScript`, `writeManagedScriptRemote`, `refreshManagedScriptIfPresent`) and the third
 * is the one that already runs at startup. Its boolean means *present*, not *rewritten*, and it has
 * fourteen call sites across thirteen files that all read it as truthy — widening it to a union
 * would invert every one of them silently, since `'absent'` is a truthy string. One module the
 * writers report into costs no call-site change and cannot be misread.
 *
 * Scoped to a sweep, never global: `recordDuring` collects only what its own callback wrote, so a
 * concurrent install elsewhere cannot make a host look reinstalled.
 */

/**
 * What one managed-script write did. Declared here rather than imported from the sweep: the
 * writers are in the CLI's module graph and the sweep is not, so the dependency points from the
 * consumer to this file and never back.
 */
export type ManagedScriptWriteEffect = 'written' | 'unchanged'

type WriteLog = ManagedScriptWriteEffect[]

let active: WriteLog | null = null

/** Called by the writers. A no-op unless a sweep is collecting, which is the normal case. */
export function recordManagedScriptWrite(effect: ManagedScriptWriteEffect): void {
  active?.push(effect)
}

/**
 * Run `install` and report whether it rewrote anything.
 *
 * Not re-entrant on purpose: two sweeps collecting at once would each see the other's writes, and
 * the sweep runs hosts one at a time precisely so that cannot happen. A nested call throws rather
 * than quietly attributing writes to the wrong host.
 */
export async function recordManagedScriptWritesDuring(
  install: () => Promise<unknown>
): Promise<ManagedScriptWriteEffect> {
  if (active) {
    throw new Error('managed script write log is already collecting')
  }
  const log: WriteLog = []
  active = log
  try {
    await install()
  } finally {
    active = null
  }
  return log.includes('written') ? 'written' : 'unchanged'
}
