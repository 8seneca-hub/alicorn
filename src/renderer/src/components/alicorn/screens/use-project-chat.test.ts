import { describe, expect, it } from 'vitest'
import { projectChatPrompt } from './use-project-chat'
import { projectChatSubjectId } from '../../../../../shared/alicorn/task-session'

describe('the project chat', () => {
  it('opens on a brief that names the project and points at the tools', () => {
    const prompt = projectChatPrompt({ name: 'Payments Platform', key: 'PAY' })
    expect(prompt).toContain('Payments Platform (PAY)')
    expect(prompt).toContain('alicorn_* MCP tools')
    expect(prompt).toContain('receipt')
  })

  // A project chat and a task share one table, so their keys must not be able to collide: no task
  // id carries a colon.
  it('keys its session so it can never be mistaken for a task', () => {
    expect(projectChatSubjectId('prj_1')).toBe('project:prj_1')
  })
})
