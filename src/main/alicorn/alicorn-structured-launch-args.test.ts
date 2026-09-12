import { describe, expect, it } from 'vitest'
import { alicornStructuredClaudeArgs } from './alicorn-structured-launch-args'

const USER_DATA = '/tmp/alicorn-user-data'
const CONFIG = `${USER_DATA}/alicorn-mcp/mcp.json`

describe('the launch args a structured Claude session inherits', () => {
  it('points the session at Alicorn’s MCP config', () => {
    expect(alicornStructuredClaudeArgs([], USER_DATA, () => true)).toEqual(['--mcp-config', CONFIG])
  })

  it('keeps the args already configured', () => {
    expect(alicornStructuredClaudeArgs(['--model', 'opus'], USER_DATA, () => true)).toEqual([
      '--model',
      'opus',
      '--mcp-config',
      CONFIG
    ])
  })

  it('yields to a config the user chose themselves', () => {
    const tokens = ['--mcp-config', '/home/me/mine.json']
    expect(alicornStructuredClaudeArgs(tokens, USER_DATA, () => true)).toEqual(tokens)
    expect(
      alicornStructuredClaudeArgs(['--mcp-config=/home/me/mine.json'], USER_DATA, () => true)
    ).toEqual(['--mcp-config=/home/me/mine.json'])
  })

  // `claude --mcp-config <absent path>` exits, so an unwritten config has to cost the session its
  // tools rather than its start.
  it('passes no flag when the config has not been written', () => {
    expect(alicornStructuredClaudeArgs(['--model', 'opus'], USER_DATA, () => false)).toEqual([
      '--model',
      'opus'
    ])
  })
})
