import { describe, expect, it } from 'vitest'
import {
  CompatibilityCliCommandSchema,
  COMPATIBILITY_CLI_COMMANDS,
  toLegacyCompatibilityCliCommand
} from './orchestration-cli-command-wire'
import {
  ORCHESTRATION_ALICORN_CLI_COMMAND_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES
} from './protocol-version'

describe('the compatibility CLI command wire vocabulary', () => {
  // Widening what a host accepts is the additive half: every value an older client sends must
  // still validate, or this "compatibility" field breaks the compatibility it exists for.
  it('still accepts every pre-rebrand spelling', () => {
    for (const command of ['orca', 'orca-ide', 'orca-dev']) {
      expect(CompatibilityCliCommandSchema.parse(command)).toBe(command)
    }
  })

  it('accepts the post-rebrand spellings a newer client may negotiate', () => {
    for (const command of ['alicorn', 'alicorn-ide', 'alicorn-dev']) {
      expect(CompatibilityCliCommandSchema.parse(command)).toBe(command)
    }
  })

  // The reason the client half is negotiated rather than additive: a known key with an
  // out-of-domain value fails outright, unlike an unknown key, which is stripped.
  it('rejects a name from neither era, so the field cannot become free text', () => {
    expect(CompatibilityCliCommandSchema.safeParse('claude').success).toBe(false)
    expect(CompatibilityCliCommandSchema.safeParse('alicorn.cmd').success).toBe(false)
  })

  it('downgrades each new spelling to the one an older host knows', () => {
    expect(toLegacyCompatibilityCliCommand('alicorn')).toBe('orca')
    expect(toLegacyCompatibilityCliCommand('alicorn-ide')).toBe('orca-ide')
    expect(toLegacyCompatibilityCliCommand('alicorn-dev')).toBe('orca-dev')
  })

  it('leaves a legacy spelling alone, so downgrading twice is the same as once', () => {
    for (const command of ['orca', 'orca-ide', 'orca-dev'] as const) {
      expect(toLegacyCompatibilityCliCommand(command)).toBe(command)
    }
  })

  it('has a legacy counterpart for every value, so no spelling can reach an old host unmapped', () => {
    for (const command of COMPATIBILITY_CLI_COMMANDS) {
      expect(['orca', 'orca-ide', 'orca-dev']).toContain(toLegacyCompatibilityCliCommand(command))
    }
  })

  it('advertises the capability, so a client can tell a new host from an old one', () => {
    expect(RUNTIME_CAPABILITIES).toContain(ORCHESTRATION_ALICORN_CLI_COMMAND_RUNTIME_CAPABILITY)
  })
})
