import { describe, expect, it } from 'vitest'
import { orgChatPrompt } from './use-org-chat'
import { ORG_CHAT_SUBJECT_ID } from '../../../../../shared/alicorn/task-session'

describe('the org chat', () => {
  it('opens on a brief that claims the whole library, not one project', () => {
    const prompt = orgChatPrompt()
    expect(prompt).toContain('not for one project')
    expect(prompt).toContain('alicorn_* MCP tools')
    expect(prompt).toContain('receipt')
  })

  // One session for the org, and a key no task or project chat can collide with.
  it('is keyed by a constant, distinct from a task or a project chat', () => {
    expect(ORG_CHAT_SUBJECT_ID).toBe('org:chat')
    expect(ORG_CHAT_SUBJECT_ID).not.toMatch(/^tsk_/)
    expect(ORG_CHAT_SUBJECT_ID.startsWith('project:')).toBe(false)
  })
})
