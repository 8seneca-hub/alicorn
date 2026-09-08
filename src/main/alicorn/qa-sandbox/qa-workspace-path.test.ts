import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveQaPath, type QaPathFs } from './qa-workspace-path'

let root: string
let workspace: string
let sibling: string

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'alicorn-qa-path-')))
  workspace = join(root, 'workspace')
  sibling = join(root, 'sibling')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  mkdirSync(join(sibling, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'impl.ts'), 'export const a = 1\n')
  writeFileSync(join(sibling, 'src', 'impl.ts'), 'export const a = 1\n')
  symlinkSync(join(workspace, 'src'), join(workspace, 'tests', 'peek'))
  symlinkSync(sibling, join(workspace, 'elsewhere'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveQaPath', () => {
  it('resolves a plain path inside the workspace', () => {
    expect(resolveQaPath({ path: 'src/impl.ts', workspacePath: workspace })).toEqual({
      kind: 'inside',
      relativePath: join('src', 'impl.ts')
    })
  })

  it('resolves a file that does not exist yet, so QA can write a new test', () => {
    expect(resolveQaPath({ path: 'tests/new.test.ts', workspacePath: workspace })).toEqual({
      kind: 'inside',
      relativePath: join('tests', 'new.test.ts')
    })
  })

  // Traversal: the classic way out of an allow list.
  it('reports a `..` escape as outside', () => {
    expect(resolveQaPath({ path: '../sibling/src/impl.ts', workspacePath: workspace }).kind).toBe(
      'outside'
    )
    expect(resolveQaPath({ path: sibling, workspacePath: workspace }).kind).toBe('outside')
  })

  // Symlink: a readable directory that points at the implementation.
  it('follows a symlink out of a readable directory back into the implementation', () => {
    expect(resolveQaPath({ path: 'tests/peek/impl.ts', workspacePath: workspace })).toEqual({
      kind: 'inside',
      relativePath: join('src', 'impl.ts')
    })
  })

  it('follows a symlink that leaves the workspace entirely', () => {
    expect(resolveQaPath({ path: 'elsewhere/src/impl.ts', workspacePath: workspace }).kind).toBe(
      'outside'
    )
  })

  // A workspace this process cannot see means it is on the wrong side of the execution boundary.
  it('reports an unreadable workspace as unresolvable rather than guessing', () => {
    const blind: QaPathFs = {
      exists: () => false,
      realpath: (path) => path
    }
    const verdict = resolveQaPath({ path: 'tests/a.test.ts', workspacePath: '/wsl/home/x' }, blind)
    expect(verdict.kind).toBe('unresolvable')
  })
})
