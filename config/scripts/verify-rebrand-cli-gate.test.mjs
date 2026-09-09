import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  BARE_ORCA_INVOCATION,
  compareAgainstBaseline,
  findBareOrcaInvocations,
  normalizeInvocationText,
  readBaseline,
  renderBaseline
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

describe('normalizeInvocationText', () => {
  it('collapses indentation and interior runs so a reflow is not a new call site', () => {
    expect(normalizeInvocationText('\t  - run `orca  status`\t--json  ')).toBe(
      '- run `orca status` --json'
    )
  })
})

describe('findBareOrcaInvocations', () => {
  it('reports each hit with its 1-based line and the invocation, not the line', () => {
    const files = new Map([
      ['skill-guides/a.md', 'intro\n  run `orca status` first\nend'],
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

const baselineOf = (rows) => readBaseline(renderBaseline(rows))

describe('compareAgainstBaseline', () => {
  const original = [
    { path: 'skill-guides/a.md', line: 2, text: 'orca status' },
    { path: 'skill-guides/a.md', line: 5, text: 'orca run' }
  ]
  const baseline = baselineOf(original)

  it('passes an unchanged corpus', () => {
    const result = compareAgainstBaseline(original, baseline)
    expect(result.newFindings).toEqual([])
    expect(result.allowedCount).toBe(2)
    expect(result.baselineCount).toBe(2)
    expect(result.retiredCount).toBe(0)
  })

  // The whole point of the ticket: inserting prose above a baselined invocation
  // shifted every entry below it and each shifted line reported as new. Twenty-six
  // false findings from two commits, of which exactly one was real.
  it('stays silent when every baselined invocation moves down the file', () => {
    const shifted = original.map((finding) => ({ ...finding, line: finding.line + 40 }))

    expect(compareAgainstBaseline(shifted, baseline).newFindings).toEqual([])
  })

  it('flags a genuinely new invocation added to a baselined file', () => {
    const findings = [...original, { path: 'skill-guides/a.md', line: 7, text: 'orca doctor' }]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual([
      { path: 'skill-guides/a.md', line: 7, text: 'orca doctor' }
    ])
  })

  it('flags an entry in a file the baseline never listed', () => {
    const findings = [{ path: 'skill-guides/new.md', line: 1, text: 'orca status' }]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual(findings)
  })

  // Content keying is not a free pass to edit the invocation itself: a reworded
  // call site is a call site nobody has read against the rename.
  it('flags a baselined invocation whose text changed', () => {
    const findings = [
      { path: 'skill-guides/a.md', line: 2, text: 'orca status --json' },
      { path: 'skill-guides/a.md', line: 5, text: 'orca run' }
    ]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual([
      { path: 'skill-guides/a.md', line: 2, text: 'orca status --json' }
    ])
  })

  // Duplicates need a count, not a set: two allowances, three occurrences, one new.
  it('allows only as many copies of a line as the baseline counted', () => {
    const twice = baselineOf([
      { path: 'skill-guides/a.md', line: 1, text: 'orca status' },
      { path: 'skill-guides/a.md', line: 9, text: 'orca status' }
    ])
    expect(twice).toEqual([{ path: 'skill-guides/a.md', text: 'orca status', count: 2 }])

    const thrice = [1, 9, 12].map((line) => ({
      path: 'skill-guides/a.md',
      line,
      text: 'orca status'
    }))
    const result = compareAgainstBaseline(thrice, twice)
    expect(result.newFindings).toEqual([
      { path: 'skill-guides/a.md', line: 12, text: 'orca status' }
    ])
    expect(result.allowedCount).toBeGreaterThan(result.baselineCount)
  })

  // Deleting call sites is the direction R3 goes; it reports, it must not fail.
  it('counts an unused allowance as retired rather than new', () => {
    const result = compareAgainstBaseline([original[0]], baseline)
    expect(result.newFindings).toEqual([])
    expect(result.retiredCount).toBe(1)
  })
})

describe('readBaseline', () => {
  it('drops comments and blank lines', () => {
    expect(readBaseline('# header\n\n2\tskill-guides/a.md\torca status\n')).toEqual([
      { path: 'skill-guides/a.md', text: 'orca status', count: 2 }
    ])
  })

  // A stale `path:line` baseline must fail loudly; read as text it would silently
  // allow nothing and bury the real corpus in false findings.
  it('rejects the old path:line format instead of reading it as an invocation', () => {
    expect(() => readBaseline('skill-guides/a.md:2\n')).toThrow(/Malformed baseline row/)
  })
})

describe('the checked-in baseline', () => {
  // Why the real script and the real corpus: this gate was verified with `pnpm tc` and
  // `pnpm test config/scripts` and is in neither, so main sat red on a check nothing ran.
  it('passes the gate against the tree as it stands', () => {
    const output = execFileSync(process.execPath, ['config/scripts/verify-rebrand-cli-gate.mjs'], {
      encoding: 'utf8'
    })

    expect(output).toMatch(/Rebrand CLI gate passed/)
  })

  it('is what --write would produce, so nobody has hand-edited a row', () => {
    const onDisk = readFileSync('config/rebrand-cli-baseline.txt', 'utf8')
    const parsed = readBaseline(onDisk)

    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.every((entry) => entry.count > 0 && entry.text.includes('orca'))).toBe(true)
    const rerendered = parsed.flatMap((entry) =>
      Array.from({ length: entry.count }, () => ({ path: entry.path, text: entry.text }))
    )
    expect(`${renderBaseline(rerendered)}\n`).toBe(onDisk)
  })
})

describe('generated single-line bundles', () => {
  // The bundle holds a whole guide as one string literal. Keying on the line meant editing any
  // guide rewrote that line and reported a new call site; the unit has to be the invocation.
  it('reports every invocation on a line, and is unmoved by unrelated text on it', () => {
    const before = new Map([
      ['src/cli/bundled-skill-guides.ts', 'const A = "orca status and orca run"']
    ])
    const after = new Map([
      ['src/cli/bundled-skill-guides.ts', 'const A = "orca status, edited, and orca run"']
    ])

    const texts = (files) => findBareOrcaInvocations(files).map((f) => f.text)
    expect(texts(before)).toEqual(['orca status', 'orca run'])
    expect(texts(after)).toEqual(texts(before))
  })
})
