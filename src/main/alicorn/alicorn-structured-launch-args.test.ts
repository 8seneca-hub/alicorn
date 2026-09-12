import { describe, expect, it } from 'vitest'
import { alicornStructuredClaudeArgs } from './alicorn-structured-launch-args'
import { buildClaudeAgentsArgument, DEFAULT_MEMBERS } from '../../shared/alicorn/default-members'

const USER_DATA = '/tmp/alicorn-user-data'
const CONFIG = `${USER_DATA}/alicorn-mcp/mcp.json`
const present = (): boolean => true
const absent = (): boolean => false

function flagValue(tokens: readonly string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index === -1 ? undefined : tokens[index + 1]
}

describe('the launch args a structured Claude session inherits', () => {
  it('points the session at Alicorn’s MCP config and its members', () => {
    const tokens = alicornStructuredClaudeArgs([], USER_DATA, present)
    expect(flagValue(tokens, '--mcp-config')).toBe(CONFIG)
    expect(flagValue(tokens, '--agents')).toBe(buildClaudeAgentsArgument())
  })

  it('keeps the args already configured', () => {
    const tokens = alicornStructuredClaudeArgs(['--model', 'opus'], USER_DATA, present)
    expect(tokens.slice(0, 2)).toEqual(['--model', 'opus'])
  })

  it('yields to a config the user chose themselves', () => {
    const tokens = alicornStructuredClaudeArgs(
      ['--mcp-config', '/home/me/mine.json'],
      USER_DATA,
      present
    )
    expect(flagValue(tokens, '--mcp-config')).toBe('/home/me/mine.json')
    expect(tokens.filter((token) => token === '--mcp-config')).toHaveLength(1)
  })

  it('yields to agents the user defined themselves', () => {
    const tokens = alicornStructuredClaudeArgs(['--agents', '{}'], USER_DATA, present)
    expect(flagValue(tokens, '--agents')).toBe('{}')
    expect(tokens.filter((token) => token === '--agents')).toHaveLength(1)
  })

  // `claude --mcp-config <absent path>` exits, so an unwritten config has to cost the session its
  // tools rather than its start. The members do not depend on a file and still go on.
  it('passes no MCP flag when the config has not been written', () => {
    const tokens = alicornStructuredClaudeArgs(['--model', 'opus'], USER_DATA, absent)
    expect(tokens).not.toContain('--mcp-config')
    expect(tokens).toContain('--agents')
  })

  // `--mcp-config` is variadic: a bare positional after it is read as a second config path, which
  // is how a prompt once became a file Claude could not find.
  it('never leaves a bare positional after the variadic MCP flag', () => {
    const tokens = alicornStructuredClaudeArgs([], USER_DATA, present)
    const after = tokens.indexOf('--mcp-config') + 2
    expect(
      tokens.slice(after).every((token) => token.startsWith('--') || token.startsWith('{'))
    ).toBe(true)
  })
})

describe('the core member set', () => {
  it('is Claude throughout, because that is the only backend this phase covers', () => {
    expect(DEFAULT_MEMBERS.every((entry) => entry.member.backend === 'claude')).toBe(true)
  })

  it('states a member’s rules once — the library row and the subagent share the text', () => {
    for (const entry of DEFAULT_MEMBERS) {
      expect(entry.member.systemRules).toBe(entry.agent.prompt)
    }
  })

  // CLAUDE.md: a reviewer never edits, so the rule is the tool surface rather than a request.
  it('gives the reviewer and the architect no way to write code', () => {
    for (const name of ['alicorn-reviewer', 'alicorn-architect']) {
      const entry = DEFAULT_MEMBERS.find((candidate) => candidate.agentName === name)
      expect(entry?.agent.tools).toBeDefined()
      expect(entry?.agent.tools).not.toContain('Write')
      expect(entry?.agent.tools).not.toContain('Edit')
    }
  })

  it('tells QA not to read the implementation it is testing', () => {
    const qa = DEFAULT_MEMBERS.find((entry) => entry.agentName === 'alicorn-qa')
    expect(qa?.agent.prompt).toContain('Do not read the code you are testing')
  })

  it('builds an --agents value Claude Code would accept', () => {
    const parsed = JSON.parse(buildClaudeAgentsArgument()) as Record<
      string,
      { description?: string; prompt?: string }
    >
    expect(Object.keys(parsed)).toHaveLength(DEFAULT_MEMBERS.length)
    for (const [name, definition] of Object.entries(parsed)) {
      // The docs require lowercase-and-hyphens, and reject a leading `-` or any `:`.
      expect(name).toMatch(/^[a-z][a-z-]*$/)
      expect(definition.description).toBeTruthy()
      expect(definition.prompt).toBeTruthy()
    }
  })
})
