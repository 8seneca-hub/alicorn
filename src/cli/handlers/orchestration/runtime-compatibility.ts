import { RuntimeClientError } from '../../runtime-client'
import {
  COMPATIBILITY_CLI_COMMANDS,
  toLegacyCompatibilityCliCommand,
  type CompatibilityCliCommand
} from '../../../shared/orchestration-cli-command-wire'

function isCompatibilityCliCommand(value: string | undefined): value is CompatibilityCliCommand {
  return COMPATIBILITY_CLI_COMMANDS.some((command) => command === value)
}

/**
 * The command this CLI is invoked as, in its own vocabulary.
 *
 * Post-rebrand by default. `resolveWireCompatibilityCliCommand` is what decides whether the host
 * can be told that spelling — a host predating the capability is sent the pre-rebrand one, which
 * still resolves for the user because the `orca` shim ships for one more release.
 */
export function resolveCompatibilityCliCommand(): CompatibilityCliCommand {
  const configured = process.env.ALICORN_CLI_COMMAND
  if (isCompatibilityCliCommand(configured)) {
    return configured
  }
  return process.platform === 'linux' ? 'alicorn-ide' : 'alicorn'
}

/**
 * What may actually go on the wire to *this* host.
 *
 * A known key carrying an out-of-domain value fails zod outright, so an un-negotiated `alicorn`
 * would fail the whole RPC on an older host rather than degrade. Downgrading the spelling costs the
 * user nothing: the hint they are shown still names a command their machine resolves.
 */
export function resolveWireCompatibilityCliCommand(
  hostCapabilities: readonly string[] | undefined,
  capability: string
): CompatibilityCliCommand {
  const command = resolveCompatibilityCliCommand()
  return hostCapabilities?.includes(capability) ? command : toLegacyCompatibilityCliCommand(command)
}

export function resolvePackagedWindowsCompatibilityCommand(): 'orca' | 'orca-ide' | undefined {
  if (process.env.ALICORN_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.ALICORN_CLI_COMMAND
  // Why still the legacy pair: this value names a *packaged launcher* the host may re-invoke, and
  // it is not covered by the capability the wire command negotiates. It moves with BC2's packaging.
  if (command === 'orca' || command === 'orca-ide') {
    return command
  }
  if (command === 'alicorn' || command === 'alicorn-ide') {
    return command === 'alicorn' ? 'orca' : 'orca-ide'
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Alicorn launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.ALICORN_DEV_CLI_INVOCATION === '1' ||
    (process.env.ALICORN_USER_DATA_PATH?.includes('orca-dev') ?? false)
  )
}
