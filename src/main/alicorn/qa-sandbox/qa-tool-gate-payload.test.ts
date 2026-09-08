import { describe, expect, it } from 'vitest'
import { qaToolUseFromPreToolUsePayload } from './qa-tool-gate-payload'

const WS = '/repo/wt'

describe('qaToolUseFromPreToolUsePayload', () => {
  it('reads the path a file tool names, whichever spelling it uses', () => {
    expect(
      qaToolUseFromPreToolUsePayload(
        { tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } },
        WS
      )?.paths
    ).toEqual(['src/a.ts'])
    expect(
      qaToolUseFromPreToolUsePayload(
        { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } },
        WS
      )?.paths
    ).toEqual(['a.ipynb'])
  })

  it('treats a search pattern that walks directories as a path', () => {
    expect(
      qaToolUseFromPreToolUsePayload(
        { tool_name: 'Glob', tool_input: { path: 'tests', pattern: '../src/**/*.ts' } },
        WS
      )?.paths
    ).toEqual(['tests', '../src/**/*.ts'])
  })

  it('defaults a tree search with no path to the workspace root', () => {
    expect(
      qaToolUseFromPreToolUsePayload({ tool_name: 'Grep', tool_input: { pattern: 'foo' } }, WS)
        ?.paths
    ).toEqual(['.'])
  })

  it('carries a shell command through for scanning', () => {
    expect(
      qaToolUseFromPreToolUsePayload(
        { tool_name: 'Bash', tool_input: { command: 'cat src/a.ts' } },
        WS
      )?.command
    ).toBe('cat src/a.ts')
  })

  it('returns nothing without a tool name', () => {
    expect(qaToolUseFromPreToolUsePayload({ tool_input: {} }, WS)).toBeNull()
  })
})
