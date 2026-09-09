import { describe, expect, it } from 'vitest'
import { isAgentHookEndpointFileName, parseAgentHookEndpointFile } from './agent-hook-endpoint-file'
import { ALICORN_HOOK_PROTOCOL_VERSION } from './agent-hook-types'

describe('agent hook endpoint files', () => {
  it('recognizes POSIX and Windows endpoint file names', () => {
    expect(isAgentHookEndpointFileName('endpoint.env')).toBe(true)
    expect(isAgentHookEndpointFileName('endpoint.cmd')).toBe(true)
    expect(isAgentHookEndpointFileName('endpoint.ps1')).toBe(false)
  })

  it('parses POSIX endpoint.env contents', () => {
    expect(
      parseAgentHookEndpointFile(
        [
          'ALICORN_AGENT_HOOK_PORT=12345',
          'ALICORN_AGENT_HOOK_TOKEN=token-123',
          'ALICORN_AGENT_HOOK_ENV=production',
          'ALICORN_AGENT_HOOK_VERSION=1'
        ].join('\n')
      )
    ).toEqual({
      port: '12345',
      token: 'token-123',
      env: 'production',
      version: '1'
    })
  })

  it('parses Windows endpoint.cmd contents', () => {
    expect(
      parseAgentHookEndpointFile(
        [
          'set ALICORN_AGENT_HOOK_PORT=54321',
          'set ALICORN_AGENT_HOOK_TOKEN=token-abc',
          'set ALICORN_AGENT_HOOK_ENV=development',
          'set ALICORN_AGENT_HOOK_VERSION=1'
        ].join('\r\n')
      )
    ).toEqual({
      port: '54321',
      token: 'token-abc',
      env: 'development',
      version: '1'
    })
  })

  it('preserves equals signs in endpoint values', () => {
    expect(
      parseAgentHookEndpointFile(
        [
          'ALICORN_AGENT_HOOK_PORT=12345',
          'ALICORN_AGENT_HOOK_TOKEN=token=with=equals',
          'ALICORN_AGENT_HOOK_ENV=production',
          'ALICORN_AGENT_HOOK_VERSION=1'
        ].join('\n')
      ).token
    ).toBe('token=with=equals')
  })

  // Why: the file on disk survives the upgrade that renames the env. A PTY started by the
  // previous release keeps pointing at it, so the pre-rebrand spelling has to keep parsing.
  it('parses a pre-rebrand endpoint file written under the ORCA_ names', () => {
    expect(
      parseAgentHookEndpointFile(
        [
          'ORCA_AGENT_HOOK_PORT=12345',
          'ORCA_AGENT_HOOK_TOKEN=token-123',
          'ORCA_AGENT_HOOK_ENV=production',
          'ORCA_AGENT_HOOK_VERSION=1'
        ].join('\n')
      )
    ).toEqual({ port: '12345', token: 'token-123', env: 'production', version: '1' })
  })

  it('prefers the ALICORN_ value when a file carries both spellings', () => {
    expect(
      parseAgentHookEndpointFile(
        [
          'ORCA_AGENT_HOOK_PORT=1111',
          'ALICORN_AGENT_HOOK_PORT=2222',
          'ALICORN_AGENT_HOOK_TOKEN=token-123',
          'ALICORN_AGENT_HOOK_ENV=production',
          'ALICORN_AGENT_HOOK_VERSION=2'
        ].join('\n')
      ).port
    ).toBe('2222')
  })

  // Why: the version the rename ships under must differ from the one pre-rebrand scripts
  // report, or a stale ORCA_-only script reads as current and silently never reinstalls.
  it('reports a pre-rebrand version that no longer matches the protocol version', () => {
    const parsed = parseAgentHookEndpointFile(
      [
        'ORCA_AGENT_HOOK_PORT=12345',
        'ORCA_AGENT_HOOK_TOKEN=token-123',
        'ORCA_AGENT_HOOK_ENV=production',
        'ORCA_AGENT_HOOK_VERSION=1'
      ].join('\n')
    )
    expect(parsed.version).not.toBe(ALICORN_HOOK_PROTOCOL_VERSION)
  })

  it('throws when required endpoint fields are missing', () => {
    expect(() => parseAgentHookEndpointFile('ALICORN_AGENT_HOOK_PORT=12345')).toThrow(
      'Agent hook endpoint file is missing required fields'
    )
  })
})
