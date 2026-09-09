import { describe, expect, it } from 'vitest'
import {
  combineHookReinstallEffects,
  describeHookReinstallHost,
  sweepHookReinstall,
  unreachableHookHosts,
  type HookReinstallHost
} from './hook-reinstall-sweep'

const LOCAL: HookReinstallHost = { kind: 'local' }
const WSL: HookReinstallHost = { kind: 'wsl', distro: 'Ubuntu' }
const SSH: HookReinstallHost = { kind: 'ssh', connectionId: 'conn-1' }

describe('sweepHookReinstall', () => {
  it('reports a host whose scripts were already byte-identical as current', async () => {
    const outcomes = await sweepHookReinstall({
      hosts: [LOCAL],
      reinstall: async () => 'unchanged'
    })

    expect(outcomes).toEqual([{ host: LOCAL, status: 'current' }])
  })

  it('reports a host that still held a pre-rename script as reinstalled', async () => {
    const outcomes = await sweepHookReinstall({
      hosts: [WSL],
      reinstall: async () => 'written'
    })

    expect(outcomes).toEqual([{ host: WSL, status: 'reinstalled' }])
  })

  // The rule this module exists for.
  it('reports a host that could not be reached as unreachable, never as current', async () => {
    const outcomes = await sweepHookReinstall({
      hosts: [SSH],
      reinstall: async () => {
        throw new Error('connect ETIMEDOUT 10.0.0.4:22')
      }
    })

    expect(outcomes).toEqual([
      { host: SSH, status: 'unreachable', detail: 'connect ETIMEDOUT 10.0.0.4:22' }
    ])
  })

  it('carries a non-Error rejection through as its own detail', async () => {
    const outcomes = await sweepHookReinstall({
      hosts: [SSH],
      reinstall: async () => {
        // An SFTP layer can reject with a bare string; the detail must survive that.
        // eslint-disable-next-line no-throw-literal
        throw 'sftp channel closed'
      }
    })

    expect(outcomes[0]?.detail).toBe('sftp channel closed')
  })

  it('gives every host an outcome even when one of them fails', async () => {
    const outcomes = await sweepHookReinstall({
      hosts: [LOCAL, WSL, SSH],
      reinstall: async (host) => {
        if (host.kind === 'wsl') {
          throw new Error('distro not running')
        }
        return host.kind === 'local' ? 'unchanged' : 'written'
      }
    })

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'current',
      'unreachable',
      'reinstalled'
    ])
  })

  // Sequential, because SSH hosts share a session budget.
  it('sweeps hosts one at a time', async () => {
    const visited: string[] = []
    let concurrent = 0
    let peak = 0

    await sweepHookReinstall({
      hosts: [SSH, { kind: 'ssh', connectionId: 'conn-2' }],
      reinstall: async (host) => {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        visited.push(describeHookReinstallHost(host))
        await Promise.resolve()
        concurrent -= 1
        return 'unchanged'
      }
    })

    expect(peak).toBe(1)
    expect(visited).toEqual(['ssh:conn-1', 'ssh:conn-2'])
  })

  it('never throws, whatever the hosts do', async () => {
    await expect(
      sweepHookReinstall({
        hosts: [LOCAL, WSL],
        reinstall: async () => {
          throw new Error('everything is on fire')
        }
      })
    ).resolves.toHaveLength(2)
  })
})

describe('combineHookReinstallEffects', () => {
  it('treats one rewritten script as a reinstalled host', () => {
    expect(combineHookReinstallEffects(['unchanged', 'written', 'unchanged'])).toBe('written')
  })

  it('is unchanged only when every script was', () => {
    expect(combineHookReinstallEffects(['unchanged', 'unchanged'])).toBe('unchanged')
    // A host with no managed agents installed has nothing to rewrite, and that is not a rewrite.
    expect(combineHookReinstallEffects([])).toBe('unchanged')
  })
})

describe('unreachableHookHosts', () => {
  it('names the hosts an operator has to go and fix, with the reason', () => {
    expect(
      unreachableHookHosts([
        { host: LOCAL, status: 'current' },
        { host: WSL, status: 'unreachable', detail: 'distro not running' },
        { host: SSH, status: 'unreachable' }
      ])
    ).toEqual(['wsl:Ubuntu (distro not running)', 'ssh:conn-1'])
  })

  it('is empty when every host answered', () => {
    expect(
      unreachableHookHosts([
        { host: LOCAL, status: 'current' },
        { host: WSL, status: 'reinstalled' }
      ])
    ).toEqual([])
  })
})
