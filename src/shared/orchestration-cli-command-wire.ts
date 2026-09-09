import { z } from 'zod'

/**
 * The CLI command names a client may name on the wire, so a host can echo a resume hint the user
 * can actually paste.
 *
 * Both eras are accepted, and that asymmetry is the whole design. Widening what a *host* accepts is
 * additive and safe — every pre-rebrand client keeps validating. Changing what a *client sends* is
 * not: `compatibilityCliCommand` is a known key, and zod fails an out-of-domain value outright
 * rather than stripping it the way it strips an unknown key. A client that sent `alicorn` to a host
 * predating this list would fail the entire RPC, so it sends the new spelling only when the host
 * advertises `ORCHESTRATION_ALICORN_CLI_COMMAND_RUNTIME_CAPABILITY`.
 *
 * `docs/reference/remote-wire-compatibility.md`, Rule 2: a change an older peer cannot decode is
 * negotiated, never assumed.
 */
export const COMPATIBILITY_CLI_COMMANDS = [
  // Pre-rebrand, still shipped as a compatibility shim and still what an old host expects.
  'orca',
  'orca-ide',
  'orca-dev',
  // Post-rebrand (R2, R5a).
  'alicorn',
  'alicorn-ide',
  'alicorn-dev'
] as const

export type CompatibilityCliCommand = (typeof COMPATIBILITY_CLI_COMMANDS)[number]

export const CompatibilityCliCommandSchema = z.enum(COMPATIBILITY_CLI_COMMANDS)

/** The pre-rebrand spelling of a command, for a host that has not advertised the new vocabulary. */
export function toLegacyCompatibilityCliCommand(
  command: CompatibilityCliCommand
): 'orca' | 'orca-ide' | 'orca-dev' {
  // Exhaustive rather than defaulted: adding a spelling should fail the build here, because a
  // value with no legacy counterpart is one that reaches an old host and fails its whole RPC.
  switch (command) {
    case 'alicorn':
      return 'orca'
    case 'alicorn-ide':
      return 'orca-ide'
    case 'alicorn-dev':
      return 'orca-dev'
    case 'orca':
    case 'orca-ide':
    case 'orca-dev':
      return command
  }
}
