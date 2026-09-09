import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BASELINE_PATH,
  ORCA_ENV_IDENTIFIER,
  ROOT,
  collectScannedFiles,
  compareAgainstBaseline,
  countByScanTarget,
  findOrcaEnvIdentifiers,
  isAllowlisted,
  readBaseline,
  renderBaseline
} from './verify-rebrand-env-gate.mjs'

const matches = (line) => line.match(new RegExp(ORCA_ENV_IDENTIFIER.source, 'g')) ?? []

describe('ORCA_ env identifier pattern', () => {
  it.each([
    ['const x = process.env.ORCA_RELAY_URL', ['ORCA_RELAY_URL']],
    ['ORCA_AGENT_HOOK_VERSION=3', ['ORCA_AGENT_HOOK_VERSION']],
    ['`${ORCA_WEB_CLIENT__}${id}`', ['ORCA_WEB_CLIENT__']],
    ['env.ORCA_A ?? env.ORCA_B', ['ORCA_A', 'ORCA_B']]
  ])('finds every identifier in %j', (line, expected) => {
    expect(matches(line)).toEqual(expected)
  })

  it.each([
    // Lowercase is prose or a table name, never an env var here.
    'the orca_env table',
    // A longer identifier that merely contains the letters.
    'MYORCA_HOME',
    // Already renamed.
    'ALICORN_RELAY_URL',
    // The product name in prose.
    'Orca reads the hook file'
  ])('leaves %j alone', (line) => {
    expect(matches(line)).toEqual([])
  })

  // `_ORCA_X` is one identifier owned by someone else; the boundary must not split it.
  it('does not match inside a leading-underscore identifier', () => {
    expect(matches('const _ORCA_X = 1')).toEqual([])
  })
})

describe('isAllowlisted', () => {
  it.each([
    'src/shared/alicorn-env-compat.ts',
    'config/scripts/verify-rebrand-env-gate.mjs',
    // The relay stack is BC1's rename, on its own timeline.
    'cloud/apps/relay/src/index.ts',
    'cloud/apps/relay-ops/src/environment-config.ts',
    'cloud/infra/terraform/environments/staging.tfvars',
    '.github/workflows/cloud-verify.yml'
  ])('exempts %j', (filePath) => {
    expect(isAllowlisted(filePath)).toBe(true)
  })

  it.each([
    'src/main/pty/wsl-orca-env.ts',
    'cloud/apps/control-api/src/index.ts',
    'cloud/packages/control-plane-contract/src/wire.ts',
    // `*` does not cross a separator: a relay-shaped path elsewhere is not exempt.
    'cloud/apps/control-api/relay/config.ts',
    '.github/workflows/release-mac-build.yml'
  ])('does not exempt %j', (filePath) => {
    expect(isAllowlisted(filePath)).toBe(false)
  })
})

describe('findOrcaEnvIdentifiers', () => {
  it('reports each hit with its 1-based line and the identifier, not the line', () => {
    const files = new Map([
      ['src/a.ts', 'const x = 1\nreturn env.ORCA_HOME\n'],
      ['src/b.ts', 'nothing here']
    ])

    expect(findOrcaEnvIdentifiers(files)).toEqual([
      { path: 'src/a.ts', line: 2, text: 'ORCA_HOME' }
    ])
  })

  it('sorts by path then line so the baseline is stable across walk order', () => {
    const files = new Map([
      ['src/b.ts', 'ORCA_HOME'],
      ['src/a.ts', 'x\nORCA_ONE\nORCA_TWO']
    ])

    expect(findOrcaEnvIdentifiers(files).map((f) => `${f.path}:${f.line}`)).toEqual([
      'src/a.ts:2',
      'src/a.ts:3',
      'src/b.ts:1'
    ])
  })

  it('skips allowlisted files entirely', () => {
    const files = new Map([['src/shared/alicorn-env-compat.ts', 'ORCA_HOME']])

    expect(findOrcaEnvIdentifiers(files)).toEqual([])
  })
})

const baselineOf = (rows) => readBaseline(renderBaseline(rows))

describe('compareAgainstBaseline', () => {
  const original = [
    { path: 'src/a.ts', line: 2, text: 'ORCA_HOME' },
    { path: 'src/a.ts', line: 5, text: 'ORCA_RELAY_URL' }
  ]
  const baseline = baselineOf(original)

  it('passes an unchanged tree', () => {
    const result = compareAgainstBaseline(original, baseline)
    expect(result.newFindings).toEqual([])
    expect(result.allowedCount).toBe(2)
    expect(result.baselineCount).toBe(2)
    expect(result.retiredCount).toBe(0)
  })

  // The sibling gate's first bug: a `path:line` key turned any insertion above a baselined
  // entry into a wall of false findings, and a gate that cries wolf gets re-baselined unread.
  it('stays silent when every baselined identifier moves down the file', () => {
    const shifted = original.map((finding) => ({ ...finding, line: finding.line + 40 }))

    expect(compareAgainstBaseline(shifted, baseline).newFindings).toEqual([])
  })

  it('flags a genuinely new identifier added to a baselined file', () => {
    const findings = [...original, { path: 'src/a.ts', line: 7, text: 'ORCA_SOMETHING_NEW' }]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual([
      { path: 'src/a.ts', line: 7, text: 'ORCA_SOMETHING_NEW' }
    ])
  })

  // A baselined name is allowed where it already was, not everywhere: the rename is per file.
  it('flags a baselined identifier appearing in a file the baseline never listed', () => {
    const findings = [{ path: 'src/new.ts', line: 1, text: 'ORCA_HOME' }]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual(findings)
  })

  it('flags a baselined identifier whose name changed', () => {
    const findings = [
      { path: 'src/a.ts', line: 2, text: 'ORCA_HOME_DIR' },
      { path: 'src/a.ts', line: 5, text: 'ORCA_RELAY_URL' }
    ]

    expect(compareAgainstBaseline(findings, baseline).newFindings).toEqual([
      { path: 'src/a.ts', line: 2, text: 'ORCA_HOME_DIR' }
    ])
  })

  // Duplicates need a count, not a set: two allowances, three occurrences, one new.
  it('allows only as many copies of an identifier as the baseline counted', () => {
    const twice = baselineOf([
      { path: 'src/a.ts', line: 1, text: 'ORCA_HOME' },
      { path: 'src/a.ts', line: 9, text: 'ORCA_HOME' }
    ])
    expect(twice).toEqual([{ path: 'src/a.ts', text: 'ORCA_HOME', count: 2 }])

    const thrice = [1, 9, 12].map((line) => ({ path: 'src/a.ts', line, text: 'ORCA_HOME' }))
    const result = compareAgainstBaseline(thrice, twice)
    expect(result.newFindings).toEqual([{ path: 'src/a.ts', line: 12, text: 'ORCA_HOME' }])
    expect(result.allowedCount).toBeGreaterThan(result.baselineCount)
  })

  // Deleting identifiers is the direction R4 goes; it reports, it must not fail.
  it('counts an unused allowance as retired rather than new', () => {
    const result = compareAgainstBaseline([original[0]], baseline)
    expect(result.newFindings).toEqual([])
    expect(result.retiredCount).toBe(1)
  })
})

describe('readBaseline', () => {
  it('drops comments and blank lines', () => {
    expect(readBaseline('# header\n\n2\tsrc/a.ts\tORCA_HOME\n')).toEqual([
      { path: 'src/a.ts', text: 'ORCA_HOME', count: 2 }
    ])
  })

  // A malformed row must fail loudly; read as text it would silently allow nothing.
  it('rejects a row without a count instead of reading it as an identifier', () => {
    expect(() => readBaseline('src/a.ts:2\n')).toThrow(/Malformed baseline row/)
  })
})

describe('countByScanTarget', () => {
  it('attributes each finding to its scan directory', () => {
    const findings = [
      { path: 'src/a.ts', line: 1, text: 'ORCA_HOME' },
      { path: 'src/b.ts', line: 1, text: 'ORCA_HOME' },
      { path: 'config/x.mjs', line: 1, text: 'ORCA_HOME' }
    ]

    expect(countByScanTarget(findings, [{ dir: 'src' }, { dir: 'config' }])).toEqual([
      { dir: 'src', count: 2 },
      { dir: 'config', count: 1 }
    ])
  })
})

describe('generated single-line bundles', () => {
  // The sibling gate's second bug: `src/cli/bundled-skill-guides.ts` holds a whole guide as one
  // string literal, so keying on the line meant any edit anywhere in it read as a new site.
  it('reports every identifier on a line, and is unmoved by unrelated text on it', () => {
    const texts = (content) =>
      findOrcaEnvIdentifiers(new Map([['src/cli/bundled-skill-guides.ts', content]])).map(
        (f) => f.text
      )

    expect(texts('const A = "set ORCA_HOME then ORCA_RELAY_URL"')).toEqual([
      'ORCA_HOME',
      'ORCA_RELAY_URL'
    ])
    expect(texts('const A = "set ORCA_HOME, edited, then ORCA_RELAY_URL"')).toEqual([
      'ORCA_HOME',
      'ORCA_RELAY_URL'
    ])
  })
})

describe('the checked-in baseline', () => {
  // Why the real tree and not a fixture: a gate verified only through its unit tests can sit red
  // on main while every suite is green. Both assertions share one scan and live in one `it` —
  // walking `src` is the expensive part here, and a second walk doubled this file's runtime.
  it('matches the tree exactly, so no row is stale and none was hand-edited', () => {
    const findings = findOrcaEnvIdentifiers(collectScannedFiles())
    const onDisk = readFileSync(BASELINE_PATH, 'utf8')
    const parsed = readBaseline(onDisk)

    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.every((entry) => entry.count > 0 && entry.text.startsWith('ORCA_'))).toBe(true)
    expect(compareAgainstBaseline(findings, parsed).newFindings).toEqual([])
    expect(`${renderBaseline(findings)}\n`).toBe(onDisk)
  }, 300_000)

  // `pnpm lint` runs from the repo root; CI steps and editors do not. Both sibling ratchets
  // learned this by reporting an empty tree from the wrong cwd.
  it('anchors on the repo root rather than the cwd', () => {
    expect(path.isAbsolute(ROOT)).toBe(true)
    expect(existsSync(path.join(ROOT, 'package.json'))).toBe(true)
  })
})
