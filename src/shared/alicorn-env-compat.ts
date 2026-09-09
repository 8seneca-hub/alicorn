/**
 * ALICORN_* / ORCA_* environment compatibility, for the one release that spans the rename.
 *
 * Two directions, and they are not symmetric:
 *  - reading: a process we did not start may still export the old names, so accept both.
 *  - exporting: a process we start may be an older build that only reads the old names, so
 *    emit both.
 *
 * This file is exempt from `verify:rebrand-env-gate` — it is the one place `ORCA_` is the point.
 */

const ALICORN_PREFIX = 'ALICORN_'
const LEGACY_PREFIX = 'ORCA_'

/** The pre-rebrand spelling of an `ALICORN_*` name. */
function legacyNameOf(name: string): string {
  return `${LEGACY_PREFIX}${name.slice(ALICORN_PREFIX.length)}`
}

/**
 * Read `ALICORN_X`, falling back to `ORCA_X`.
 *
 * Hooks and PTYs started by the previous release still export the old names, for one release.
 * An explicitly empty `ALICORN_X` wins — cleared is a value, not an absence.
 */
export function readAlicornEnv(
  env: NodeJS.ProcessEnv,
  name: `ALICORN_${string}`
): string | undefined {
  return env[name] ?? env[legacyNameOf(name)]
}

/**
 * Add `ORCA_X` for every `ALICORN_X` key, for environments we export to child processes.
 *
 * An `ORCA_X` the caller set itself is left alone: an explicit legacy value is a deliberate
 * override, and silently replacing it would make the alias the authority.
 */
export function withLegacyEnvAliases(env: Record<string, string>): Record<string, string> {
  const withAliases: Record<string, string> = { ...env }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(ALICORN_PREFIX)) {
      continue
    }
    const legacy = legacyNameOf(name)
    if (!(legacy in withAliases)) {
      withAliases[legacy] = value
    }
  }
  return withAliases
}
