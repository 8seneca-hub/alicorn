import { describe, expect, it } from 'vitest'
import { projectChatBranch, projectChatPrompt } from './use-project-chat'

describe('the project chat workspace', () => {
  // Namespaced so it never collides with a branch someone means to ship.
  it('takes a branch nobody would create by hand', () => {
    expect(projectChatBranch('PAY')).toBe('alicorn/pay-chat')
  })

  it('names the project it is standing in', () => {
    const prompt = projectChatPrompt({ name: 'Payments Platform', key: 'PAY' })

    expect(prompt).toContain('Payments Platform (PAY)')
    expect(prompt).toContain('alicorn_*')
  })

  // The MCP server's own instructions carry the rules; repeating them is a copy to drift.
  it('points at the tools rather than restating what they do', () => {
    expect(projectChatPrompt({ name: 'X', key: 'X' })).not.toContain('alicorn_create_task')
  })
})
