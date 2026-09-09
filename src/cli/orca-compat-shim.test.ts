import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'orca-compat-shim.ts'), 'utf8')

describe('orca compatibility shim', () => {
  it('is a Node entrypoint so package managers can link it as a bin', () => {
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true)
  })

  it('warns on stderr before delegating, so piped stdout stays machine-readable', () => {
    const notice = source.indexOf('process.stderr.write')
    const delegation = source.indexOf("import('./index.js')")
    expect(notice).toBeGreaterThan(-1)
    expect(delegation).toBeGreaterThan(notice)
  })

  it('delegates dynamically so the notice is not hoisted below the CLI', () => {
    expect(source).not.toMatch(/^import .*'\.\/index\.js'/m)
  })

  it('starts the CLI explicitly, because index.js only self-starts as require.main', () => {
    expect(source).toContain('main()')
  })

  it('names both commands in the notice', () => {
    expect(source).toContain('orca is now alicorn')
  })
})
