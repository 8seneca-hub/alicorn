import { describe, expect, it } from 'vitest'
import { ORG_CHAT_SUBJECT_ID } from '../../../../../shared/alicorn/task-session'

describe('the org chat', () => {
  // One session for the org, and a key no task or project chat can collide with.
  it('is keyed by a constant, distinct from a task or a project chat', () => {
    expect(ORG_CHAT_SUBJECT_ID).toBe('org:chat')
    expect(ORG_CHAT_SUBJECT_ID).not.toMatch(/^tsk_/)
    expect(ORG_CHAT_SUBJECT_ID.startsWith('project:')).toBe(false)
  })
})
