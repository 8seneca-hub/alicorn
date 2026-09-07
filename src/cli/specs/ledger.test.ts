import { describe, expect, it } from 'vitest'

import { LEDGER_COMMAND_SPECS } from './ledger'
import { GLOBAL_FLAGS, effectiveAllowedFlags } from '../args'

describe('ledger command specs', () => {
  const report = LEDGER_COMMAND_SPECS.find((entry) => entry.path.join(' ') === 'ledger report')

  it('defines ledger report', () => {
    expect(report).toBeDefined()
  })

  it('accepts the filter flags plus the global flags', () => {
    expect(effectiveAllowedFlags(report!)).toEqual(
      expect.arrayContaining([...GLOBAL_FLAGS, 'stage', 'project', 'member', 'since', 'until'])
    )
  })

  it('documents its usage with the filter flags', () => {
    expect(report!.usage).toBe(
      'orca ledger report [--stage <key>] [--project <id>] [--member <id>] [--since <iso>] [--until <iso>] [--json]'
    )
  })
})

describe('ledger outbox command specs', () => {
  const outbox = LEDGER_COMMAND_SPECS.find((entry) => entry.path.join(' ') === 'ledger outbox')
  const requeue = LEDGER_COMMAND_SPECS.find(
    (entry) => entry.path.join(' ') === 'ledger outbox-requeue'
  )

  it('defines ledger outbox and ledger outbox-requeue', () => {
    expect(outbox).toBeDefined()
    expect(requeue).toBeDefined()
  })

  it('accepts --dead and --limit plus the global flags on ledger outbox', () => {
    expect(effectiveAllowedFlags(outbox!)).toEqual(
      expect.arrayContaining([...GLOBAL_FLAGS, 'dead', 'limit'])
    )
  })

  it('accepts --id plus the global flags on ledger outbox-requeue', () => {
    expect(effectiveAllowedFlags(requeue!)).toEqual(expect.arrayContaining([...GLOBAL_FLAGS, 'id']))
  })

  it('documents usage for both commands', () => {
    expect(outbox!.usage).toBe('orca ledger outbox [--dead] [--limit <n>] [--json]')
    expect(requeue!.usage).toBe('orca ledger outbox-requeue --id <id> [--json]')
  })
})
