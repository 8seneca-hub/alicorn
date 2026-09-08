import { describe, expect, it } from 'vitest'
import { isQaReadableRelativePath } from './qa-readable-paths'

describe('isQaReadableRelativePath', () => {
  it.each([
    'tests/checkout.test.ts',
    'src/main/alicorn/qa-tool-policy.test.ts',
    'app/models/user_spec.rb',
    'e2e/login.ts',
    'docs/acceptance-criteria.md',
    'README.md',
    '.foreman/journal.md',
    '__tests__/a.js'
  ])('reads %s', (path) => {
    expect(isQaReadableRelativePath(path)).toBe(true)
  })

  it.each([
    'src/main/alicorn/qa-tool-policy.ts',
    'package.json',
    'lib/checkout.rb',
    'src/index.ts'
  ])('withholds %s', (path) => {
    expect(isQaReadableRelativePath(path)).toBe(false)
  })

  // The root is the whole implementation, and `Grep` with no path lands here.
  it.each(['', '.', './', '/'])('withholds the workspace root spelled %o', (path) => {
    expect(isQaReadableRelativePath(path)).toBe(false)
  })

  // A case-insensitive filesystem is the classic way round a case-sensitive allow list.
  it('folds case so the same file cannot be renamed past the list', () => {
    expect(isQaReadableRelativePath('TESTS/Checkout.TEST.ts')).toBe(true)
    expect(isQaReadableRelativePath('SRC/Impl.ts')).toBe(false)
  })

  it('accepts a Windows-shaped relative path', () => {
    expect(isQaReadableRelativePath('tests\\checkout.test.ts')).toBe(true)
    expect(isQaReadableRelativePath('src\\impl.ts')).toBe(false)
  })
})
