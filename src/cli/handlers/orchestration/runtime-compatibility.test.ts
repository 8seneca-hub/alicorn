import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveCompatibilityCliCommand,
  resolveWireCompatibilityCliCommand
} from './runtime-compatibility'
import { ORCHESTRATION_ALICORN_CLI_COMMAND_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'

const CAP = ORCHESTRATION_ALICORN_CLI_COMMAND_RUNTIME_CAPABILITY
const saved = process.env.ALICORN_CLI_COMMAND

afterEach(() => {
  if (saved === undefined) {
    delete process.env.ALICORN_CLI_COMMAND
  } else {
    process.env.ALICORN_CLI_COMMAND = saved
  }
})

describe('resolveWireCompatibilityCliCommand', () => {
  it('sends the post-rebrand name to a host that advertises the capability', () => {
    process.env.ALICORN_CLI_COMMAND = 'alicorn'

    expect(resolveWireCompatibilityCliCommand([CAP], CAP)).toBe('alicorn')
  })

  // The failure this prevents: a known key with an out-of-domain value fails the whole RPC.
  it('downgrades for a host that does not, rather than failing the call', () => {
    process.env.ALICORN_CLI_COMMAND = 'alicorn-ide'

    expect(resolveWireCompatibilityCliCommand([], CAP)).toBe('orca-ide')
    expect(resolveWireCompatibilityCliCommand(undefined, CAP)).toBe('orca-ide')
  })

  it('honours an explicitly configured legacy command in both directions', () => {
    process.env.ALICORN_CLI_COMMAND = 'orca-dev'

    expect(resolveCompatibilityCliCommand()).toBe('orca-dev')
    expect(resolveWireCompatibilityCliCommand([CAP], CAP)).toBe('orca-dev')
  })

  it('ignores a name from neither era instead of putting it on the wire', () => {
    process.env.ALICORN_CLI_COMMAND = 'something-else'

    expect(['alicorn', 'alicorn-ide']).toContain(resolveCompatibilityCliCommand())
  })
})
