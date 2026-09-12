import { describe, expect, it } from 'vitest'
import { taskOpeningPrompt } from './use-task-workspace'

describe('the prompt a task session opens on', () => {
  it('leads with the task id and title, then its brief', () => {
    expect(
      taskOpeningPrompt('PAY-142', {
        title: 'Refund API',
        context: 'Partial amounts must write a ledger entry.'
      })
    ).toContain('PAY-142 — Refund API\n\nPartial amounts must write a ledger entry.')
  })

  it('is just the title when nobody wrote a brief', () => {
    expect(taskOpeningPrompt('PAY-7', { title: 'Refund API', context: '   ' })).toMatch(
      /^PAY-7 — Refund API\n/
    )
  })

  it('tells the agent the branch is its call, because nothing was created for it', () => {
    const prompt = taskOpeningPrompt('PAY-7', { title: 'Refund API', context: '' })
    expect(prompt).toContain('alicorn_* MCP tools')
    expect(prompt).toContain('own branch or worktree')
  })
})
