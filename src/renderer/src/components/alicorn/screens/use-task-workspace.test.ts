import { describe, expect, it } from 'vitest'
import { taskBranchName, taskOpeningPrompt } from './use-task-workspace'

describe('the branch a task gets', () => {
  it('carries the task id so a reviewer can place the work', () => {
    expect(taskBranchName('PAY', { number: 142, title: 'Refund API — partial refunds' })).toBe(
      'feat/pay-142-refund-api-partial-refunds'
    )
  })

  it('falls back to the id alone when the title slugs to nothing', () => {
    expect(taskBranchName('PAY', { number: 7, title: '???' })).toBe('feat/pay-7')
  })

  it('never ends on a separator', () => {
    expect(taskBranchName('PAY', { number: 7, title: 'a'.repeat(40) })).not.toMatch(/-$/)
    expect(taskBranchName('PAY', { number: 7, title: 'refund api!!!' })).toBe(
      'feat/pay-7-refund-api'
    )
  })
})

describe('the prompt a task session opens on', () => {
  it('leads with the task id and title, then its brief', () => {
    expect(
      taskOpeningPrompt('PAY-142', {
        title: 'Refund API',
        context: 'Partial amounts must write a ledger entry.'
      })
    ).toBe('PAY-142 — Refund API\n\nPartial amounts must write a ledger entry.')
  })

  it('is just the title when nobody wrote a brief', () => {
    expect(taskOpeningPrompt('PAY-7', { title: 'Refund API', context: '   ' })).toBe(
      'PAY-7 — Refund API'
    )
  })
})
