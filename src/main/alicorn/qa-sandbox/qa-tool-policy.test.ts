import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateQaToolUse } from './qa-tool-policy'
import type { QaPathFs } from './qa-workspace-path'

let root: string
let workspace: string

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'alicorn-qa-tool-')))
  workspace = join(root, 'workspace')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  mkdirSync(join(workspace, 'docs'), { recursive: true })
  mkdirSync(join(root, 'sibling', 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'impl.ts'), 'export const a = 1\n')
  writeFileSync(join(workspace, 'tests', 'impl.test.ts'), '')
  writeFileSync(join(workspace, 'docs', 'criteria.md'), '')
  writeFileSync(join(root, 'sibling', 'src', 'impl.ts'), '')
  symlinkSync(join(workspace, 'src', 'impl.ts'), join(workspace, 'tests', 'peek.test.ts'))
  symlinkSync(join(root, 'sibling'), join(workspace, 'docs', 'elsewhere'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function decide(toolName: string, paths: string[], command?: string) {
  return evaluateQaToolUse({ toolName, paths, command, workspacePath: workspace })
}

describe('evaluateQaToolUse', () => {
  it('lets QA read the tests and the requirement', () => {
    expect(decide('Read', ['tests/impl.test.ts'])).toBeNull()
    expect(decide('Read', ['docs/criteria.md'])).toBeNull()
    expect(decide('Write', ['tests/new.test.ts'])).toBeNull()
  })

  it('blocks the plainly named implementation file', () => {
    const decision = decide('Read', ['src/impl.ts'])
    expect(decision?.decision).toBe('block')
    expect(decision?.reason).toContain('implementation')
  })

  // A write into implementation needs the same refusal: QA is not there to change the code.
  it('blocks a write into implementation, not only a read', () => {
    expect(decide('Write', ['src/impl.ts'])?.decision).toBe('block')
    expect(decide('Edit', ['src/impl.ts'])?.decision).toBe('block')
  })

  // Bypass 1: traversal.
  it('blocks a traversal into a sibling checkout', () => {
    expect(decide('Read', ['../sibling/src/impl.ts'])?.decision).toBe('block')
    expect(decide('Read', [join(root, 'sibling', 'src', 'impl.ts')])?.decision).toBe('block')
  })

  // Bypass 2: a symlink whose name passes the allow list but whose target does not.
  it('blocks a symlink named like a test that points at implementation', () => {
    const decision = decide('Read', ['tests/peek.test.ts'])
    expect(decision?.decision).toBe('block')
    expect(decision?.reason).toContain('src')
  })

  it('blocks a symlinked directory that leaves the workspace', () => {
    expect(decide('Read', ['docs/elsewhere/src/impl.ts'])?.decision).toBe('block')
  })

  // Bypass 3: the shell, where the tool names no path key at all.
  it('blocks a shell command that names implementation', () => {
    expect(decide('Bash', [], 'cat src/impl.ts')?.decision).toBe('block')
    expect(decide('Bash', [], 'sh -c "head -1 src/impl.ts"')?.decision).toBe('block')
    expect(decide('Bash', [], 'find . -name "*.ts" -exec cat {} +')?.decision).toBe('block')
  })

  it('leaves a shell command that names no implementation alone', () => {
    expect(decide('Bash', [], 'pnpm test')).toBeNull()
    expect(decide('Bash', [], 'pnpm test tests/impl.test.ts')).toBeNull()
    expect(decide('Bash', [], `cd ${workspace} && pnpm test tests/impl.test.ts`)).toBeNull()
  })

  // A tree search with no path is the whole workspace.
  it('blocks an unscoped tree search', () => {
    expect(decide('Grep', ['.'])?.decision).toBe('block')
  })

  it('leaves a tool that names no path alone', () => {
    expect(decide('TodoWrite', [])).toBeNull()
  })

  // Fail closed, the way member-directory.ts does on an unreadable policy.
  it('blocks when the workspace cannot be resolved on this host', () => {
    const blind: QaPathFs = { exists: () => false, realpath: (path) => path }
    const decision = evaluateQaToolUse(
      { toolName: 'Read', paths: ['tests/a.test.ts'], workspacePath: '/wsl/home/x' },
      blind
    )
    expect(decision?.decision).toBe('block')
    expect(decision?.reason).toContain('cannot be resolved')
  })

  it('tells the agent what it may read instead of failing silently', () => {
    expect(decide('Read', ['src/impl.ts'])?.reason).toContain('acceptance criteria')
  })
})
