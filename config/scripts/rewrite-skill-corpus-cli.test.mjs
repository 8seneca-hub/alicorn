import { describe, expect, it } from 'vitest'

import { rewriteBareOrcaInvocations } from './rewrite-skill-corpus-cli.mjs'
import { findBareOrcaInvocations } from './verify-rebrand-cli-gate.mjs'

// Why a fixture and not the corpus: the codemod runs once over 400+ call sites,
// and the judgement it must not get wrong is *what it leaves alone*.
const FIXTURE = [
  '# Orca CLI',
  '',
  'Run `orca status --json`, then `orca worktree create --name x`.',
  'Three on one line: orca open; orca serve --port 1; orca tab list.',
  '```sh',
  'echo $(orca status)',
  'exec /usr/local/bin/orca status',
  'orca-ide --version',
  'orca-dev serve --port 1',
  '```',
  "Orca's embedded browser renders Orca-managed worktrees.",
  'GNOME Orca reads the screen.',
  'The recipe file is orca.yaml and the skill is orca-cli.',
  'myorca status is a different binary.'
].join('\n')

describe('rewriteBareOrcaInvocations', () => {
  it('rewrites every invocation on a line, including repeats', () => {
    const rewritten = rewriteBareOrcaInvocations(FIXTURE)

    expect(rewritten).toContain('`alicorn status --json`')
    expect(rewritten).toContain('`alicorn worktree create --name x`')
    expect(rewritten).toContain('alicorn open; alicorn serve --port 1; alicorn tab list.')
    expect(rewritten).toContain('echo $(alicorn status)')
  })

  it('leaves paths, the Linux binary, the dev handle, and prose alone', () => {
    const rewritten = rewriteBareOrcaInvocations(FIXTURE)

    expect(rewritten).toContain('exec /usr/local/bin/orca status')
    expect(rewritten).toContain('orca-ide --version')
    expect(rewritten).toContain('orca-dev serve --port 1')
    expect(rewritten).toContain("Orca's embedded browser renders Orca-managed worktrees.")
    expect(rewritten).toContain('GNOME Orca reads the screen.')
    expect(rewritten).toContain('orca.yaml and the skill is orca-cli')
    expect(rewritten).toContain('myorca status is a different binary.')
  })

  // The gate watches a shape the rewriter must not touch, so what survives is exactly
  // `orca-dev` and nothing else — those few sites stay baselined until the `bin` rename.
  it('leaves only `orca-dev`, which the gate still watches and the baseline still allows', () => {
    const rewritten = rewriteBareOrcaInvocations(FIXTURE)

    const residue = findBareOrcaInvocations(new Map([['skill-guides/fixture.md', rewritten]]))
    expect(residue.length).toBeGreaterThan(0)
    expect(residue.every((finding) => finding.text.startsWith('orca-dev '))).toBe(true)
  })

  it('is idempotent', () => {
    const once = rewriteBareOrcaInvocations(FIXTURE)

    expect(rewriteBareOrcaInvocations(once)).toBe(once)
  })
})
