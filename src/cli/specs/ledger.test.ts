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
