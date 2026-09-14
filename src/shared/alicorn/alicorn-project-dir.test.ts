import { describe, expect, it } from 'vitest'
import { addAlicornDirIgnore, alicornContextPath, ignoresAlicornDir } from './alicorn-project-dir'

describe('the .alicorn directory', () => {
  it('sits inside the repository, like .orca does', () => {
    expect(alicornContextPath('/repos/pay')).toBe('/repos/pay/.alicorn/context.md')
    expect(alicornContextPath('/repos/pay/')).toBe('/repos/pay/.alicorn/context.md')
  })

  it('recognises an existing entry however it is spelled, so it is never added twice', () => {
    expect(ignoresAlicornDir('node_modules\n.alicorn\n')).toBe(true)
    expect(ignoresAlicornDir('node_modules\n.alicorn/\n')).toBe(true)
    expect(ignoresAlicornDir('node_modules\n')).toBe(false)
    // Why not a substring test: a line mentioning the directory is not a rule excluding it.
    expect(ignoresAlicornDir('# keep .alicorn out of here one day\n')).toBe(false)
  })

  it('appends once and leaves the existing content alone', () => {
    expect(addAlicornDirIgnore('node_modules\n')).toBe('node_modules\n.alicorn\n')
    expect(addAlicornDirIgnore('node_modules')).toBe('node_modules\n.alicorn\n')
    expect(addAlicornDirIgnore('')).toBe('.alicorn\n')
  })

  it('returns the input unchanged when the rule is already there', () => {
    const existing = 'node_modules\n.alicorn\ndist\n'

    // Identical bytes, so the caller can compare and skip the write rather than dirty a watcher.
    expect(addAlicornDirIgnore(existing)).toBe(existing)
  })
})
