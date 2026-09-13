import { describe, expect, it } from 'vitest'
import {
  addAlicornImport,
  ALICORN_MD_IMPORT,
  importsAlicornMd,
  renderAlicornMd,
  upsertAlicornBlock
} from './alicorn-md'

const FACTS = {
  projectName: 'Alicorn',
  members: [{ name: 'Developer', role: 'developer', backend: 'claude' }],
  stageNames: ['Spec', 'Build', 'Merge']
}

describe('ALICORN.md', () => {
  it('names the project, its members and its pipeline', () => {
    const md = renderAlicornMd(FACTS)
    expect(md).toContain('**Alicorn**')
    expect(md).toContain('Developer')
    expect(md).toContain('Spec → Build → Merge')
  })

  // The reason it exists: a generic word must resolve to us, not to a connected tracker.
  it('says which server owns the ambiguous words', () => {
    const md = renderAlicornMd(FACTS)
    expect(md).toContain('alicorn_*')
    expect(md).toMatch(/Jira|Atlassian/)
  })

  it('states the gate rule, including that no policy means no permission', () => {
    const md = renderAlicornMd(FACTS)
    expect(md).toContain('irreversible')
    expect(md).toContain('has not authored a policy for at all')
  })

  it('replaces its own block and leaves hand-written lines alone', () => {
    const first = upsertAlicornBlock('# My notes\n\nKeep me.', renderAlicornMd(FACTS))
    const second = upsertAlicornBlock(first, renderAlicornMd({ ...FACTS, projectName: 'Renamed' }))
    expect(second).toContain('Keep me.')
    expect(second).toContain('**Renamed**')
    expect(second).not.toContain('**Alicorn** is its project here')
    // One block, not two stacked.
    expect(second.split('<!-- alicorn:start -->')).toHaveLength(2)
  })
})

describe('the CLAUDE.md import', () => {
  it('adds the line once and is idempotent', () => {
    const once = addAlicornImport('# Project\n\nRules.')
    expect(once).toContain(ALICORN_MD_IMPORT)
    expect(addAlicornImport(once)).toBe(once)
  })

  /**
   * Claude Code does not treat a backticked or fenced mention as an import, so neither may this —
   * a document that merely talks about the file would otherwise never get the real one.
   */
  it('does not count a backticked or fenced mention as importing it', () => {
    expect(importsAlicornMd('See `@ALICORN.md` for detail.')).toBe(false)
    // A doc that shows the line in a fence would otherwise convince us the real one exists.
    expect(importsAlicornMd('Add this:\n\n```\n@ALICORN.md\n```')).toBe(false)
    expect(importsAlicornMd('```\n@ALICORN.md\n```')).toBe(false)
    expect(importsAlicornMd('@ALICORN.md')).toBe(true)
  })

  it('writes into an empty CLAUDE.md without a leading blank line', () => {
    expect(addAlicornImport('').startsWith('<!--')).toBe(true)
  })
})
