import { describe, expect, it } from 'vitest'
import {
  appendOrcaRpcOutput,
  resolveOrcaCliCommand,
  resolveOrcaCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Orca CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveOrcaCliCommand({ env: { ALICORN_CLI_COMMAND: 'custom-orca' } })).toBe(
      'custom-orca'
    )
    expect(resolveOrcaCliCommand({ env: { ALICORN_DEV_REPO_ROOT: '/repo' } })).toBe('alicorn-dev')
    expect(resolveOrcaCliCommand({ env: {}, platform: 'linux' })).toBe('orca-ide')
    expect(resolveOrcaCliCommand({ env: {}, platform: 'win32' })).toBe('orca')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveOrcaCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        ALICORN_CLI_COMMAND: 'C:\\repo\\out\\bin\\orca-dev.cmd',
        ALICORN_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        ALICORN_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\orca-dev',
        ALICORN_DEV_CLI_INVOCATION: '1',
        ALICORN_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        ALICORN_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendOrcaRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendOrcaRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
