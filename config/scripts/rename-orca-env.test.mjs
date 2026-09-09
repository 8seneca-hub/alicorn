import { describe, expect, it } from 'vitest'

import { isSkipped, renameOrcaEnvIdentifiers } from './rename-orca-env.mjs'

// Why the fixtures are assembled rather than written out: the first sweep rewrote this file's
// own fixtures into `ALICORN_` on both sides, leaving every "renames" case asserting nothing.
// The codemod and this test are exempt from the gate now, but a split literal keeps the
// fixtures honest even if that exemption is ever dropped.
const LEGACY = `ORCA${'_'}`
const legacy = (name) => `${LEGACY}${name}`
const current = (name) => `ALICORN_${name}`

describe('renameOrcaEnvIdentifiers', () => {
  it.each([
    ['const x = process.env.%s', 'RELAY_URL'],
    ['%s=3', 'AGENT_HOOK_VERSION'],
    // Shell, batch and YAML spellings all reduce to the same identifier.
    ['"$%s" and later', 'PANE_KEY'],
    ['%%%s%% in a batch file', 'TAB_ID'],
    ['${%s:-} in a posix shell', 'WORKTREE_ID'],
    // WSLENV entries carry a trailing /u or /p flag the identifier must not swallow.
    ["'%s/p'", 'ROOT_PATH'],
    // Concatenated prefixes: the trailing separator is part of the identifier.
    ['`%s${key}`', 'WEB_CLIENT__'],
    // An escape sequence before the identifier is a word character, so a \b anchor skips it.
    // This is the case that survived the first sweep with the gate still reporting zero.
    ["'PORT=9\\n%s=stale'", 'AGENT_HOOK_TOKEN'],
    ["/<<'A'\\n([\\s\\S]*)\\n%s/", 'WSL_CLI']
  ])('renames %s (%s)', (template, name) => {
    expect(renameOrcaEnvIdentifiers(template.replace('%s', legacy(name)))).toBe(
      template.replace('%s', current(name))
    )
  })

  it('renames every identifier on one line', () => {
    expect(renameOrcaEnvIdentifiers(`env.${legacy('A')} ?? env.${legacy('B')}`)).toBe(
      `env.${current('A')} ?? env.${current('B')}`
    )
  })

  it.each([
    // Lowercase is prose, a shell local, or a table name.
    'orca_hook_metadata=$(printf ...)',
    // Longer identifiers that merely contain the letters.
    `MY${LEGACY}HOME`,
    `LEGACY_${LEGACY}PREFIX`,
    // Stdout sentinels for in-band SSH and WSL probes, not env names. Their protocol crosses a
    // version boundary, so renaming one would break a probe against an older remote.
    `__${LEGACY}REMOTE_PLATFORM__ Linux x86_64`,
    `const marker = '__${LEGACY}WSL_PROCESS_GROUP_'`,
    // Same category, and the reason the lookbehind keeps digits: a private in-file placeholder
    // token, reached through a `\uE000` escape whose trailing 0 is what excludes it.
    `'\\uE000${LEGACY}MD_ENTITY_NBSP\\uE000'`,
    // Already renamed.
    'ALICORN_RELAY_URL',
    // The product name, and the CLI placeholder the skill guides use.
    'Orca reads the hook file',
    'ORCA emulator devices --json',
    // A bare prefix with nothing after it needs hand review, not a blind rewrite.
    `const prefix = '${LEGACY}'`
  ])('leaves %j alone', (line) => {
    expect(renameOrcaEnvIdentifiers(line)).toBe(line)
  })
})

describe('isSkipped', () => {
  it.each([
    // The compat layer, the gate and this codemod are where the old names are the subject.
    'src/shared/alicorn-env-compat.ts',
    'config/scripts/verify-rebrand-env-gate.mjs',
    'config/scripts/rename-orca-env.mjs',
    'config/scripts/rename-orca-env.test.mjs',
    'config/rebrand-env-baseline.txt',
    // BC1 owns the relay stack's rename.
    'cloud/apps/relay/src/index.ts',
    'cloud/infra/terraform/main.tf',
    '.github/workflows/cloud-relay-deploy.yml',
    // Prose that discusses the rename by name.
    'CLAUDE.md',
    'AGENTS.md',
    'tests/e2e/AGENTS.md',
    'docs/alicorn/plans/2026-09-06-rebrand-cutover-distribution.md'
  ])('skips %j', (filePath) => {
    expect(isSkipped(filePath)).toBe(true)
  })

  it.each([
    'src/main/agent-hooks/server/server-runtime-env.ts',
    'tests/e2e/worktree-startup.ts',
    'resources/darwin/bin/alicorn',
    'skills/alicorn-cli/SKILL.md',
    'docs/reference/relay-regional-placement.md',
    '.github/workflows/e2e.yml'
  ])('rewrites %j', (filePath) => {
    expect(isSkipped(filePath)).toBe(false)
  })
})
