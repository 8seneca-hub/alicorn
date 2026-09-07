import { describe, expect, it } from 'vitest'

import {
  BARE_ORCA_INVOCATION,
  compareAgainstBaseline,
  findBareOrcaInvocations,
  readBaseline
} from './verify-rebrand-cli-gate.mjs'

describe('bare orca invocation pattern', () => {
  it.each([
    'orca orchestration send',
    '  orca status',
    'Run `orca worktree create` first.',
    'echo $(orca status)',
    'orca-dev status'
  ])('matches the invocation %j', (line) => {
    expect(BARE_ORCA_INVOCATION.test(line)).toBe(true)
  })

  it.each([
    // The Linux binary keeps its own name; `-ide` is not a subcommand.
    'orca-ide --version',
    // A path, not a command word.
    '/usr/local/bin/orca',
    'exec /usr/local/bin/orca status',
    // Already renamed; `orca-shim` is one word.
    'alicorn orca-shim',
    // A different product entirely — case matters.
    'GNOME Orca reads the screen',
    'Orca status is shown in the sidebar',
    // Part of a longer identifier.
    'myorca status'
  ])('leaves %j alone', (line) => {
    expect(BARE_ORCA_INVOCATION.test(line)).toBe(false)
  })
})

describe('findBareOrcaInvocations', () => {
  it('reports each hit with its 1-based line and trimmed text', () => {
    const files = new Map([
      ['skill-guides/a.md', 'intro\n  orca status\nend'],
      ['skill-guides/b.md', 'nothing here']
    ])

    expect(findBareOrcaInvocations(files)).toEqual([
      { path: 'skill-guides/a.md', line: 2, text: 'orca status' }
    ])
  })

  it('sorts by path then line so the baseline is stable across walk order', () => {
    const files = new Map([
      ['skill-guides/b.md', 'orca status'],
      ['skill-guides/a.md', 'x\norca run\norca stop']
    ])

    expect(findBareOrcaInvocations(files).map((f) => `${f.path}:${f.line}`)).toEqual([
      'skill-guides/a.md:2',
      'skill-guides/a.md:3',
      'skill-guides/b.md:1'
    ])
  })
})

describe('compareAgainstBaseline', () => {
  const baseline = ['skill-guides/a.md:2', 'skill-guides/a.md:5']

  it('passes an unchanged corpus', () => {
    const findings = [
      { path: 'skill-guides/a.md', line: 2, text: 'orca status' },
      { path: 'skill-guides/a.md', line: 5, text: 'orca run' }
    ]

    const result = compareAgainstBaseline(findings, baseline)
    expect(result.newFindings).toEqual([])
    expect(result.allowedCount).toBe(2)
    expect(result.baselineCount).toBe(2)
  })

  it('flags an entry in a file the baseline never listed', () => {
    const findings = [{ path: 'skill-guides/new.md', line: 1, text: 'orca status' }]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual(findings)
  })

  // A moved line is a new call site as far as the ratchet can tell, and saying so
  // is what stops a delete-plus-add from sneaking past a flat total.
  it('flags a moved line even though the count is unchanged', () => {
    const findings = [
      { path: 'skill-guides/a.md', line: 2, text: 'orca status' },
      { path: 'skill-guides/a.md', line: 9, text: 'orca run' }
    ]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual([
      { path: 'skill-guides/a.md', line: 9, text: 'orca run' }
    ])
  })

  it('reports a grown total so the caller can fail a shrink-only check', () => {
    const findings = [
      { path: 'skill-guides/a.md', line: 2, text: 'orca status' },
      { path: 'skill-guides/a.md', line: 5, text: 'orca run' },
      { path: 'skill-guides/a.md', line: 5, text: 'orca run' }
    ]

    const result = compareAgainstBaseline(findings, baseline)
    expect(result.newFindings).toEqual([])
    expect(result.allowedCount).toBeGreaterThan(result.baselineCount)
  })
})

describe('readBaseline', () => {
  it('drops comments and blank lines', () => {
    expect(readBaseline('# header\n\nskill-guides/a.md:2\n  skill-guides/b.md:3  \n')).toEqual([
      'skill-guides/a.md:2',
      'skill-guides/b.md:3'
    ])
  })
})
