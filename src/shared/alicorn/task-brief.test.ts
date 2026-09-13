import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_BRIEF_TEMPLATE, renderTaskBrief, TASK_BRIEF_PARAMS } from './task-brief'

describe('the task brief template', () => {
  it('ships a default that uses every parameter it offers', () => {
    for (const param of TASK_BRIEF_PARAMS) {
      expect(DEFAULT_TASK_BRIEF_TEMPLATE).toContain(`{{${param}}}`)
    }
  })

  it('substitutes each parameter wherever it appears', () => {
    expect(
      renderTaskBrief('{{ref}}: {{title}} ({{ref}})', { ref: 'ALC-9', title: 'Fix the rail' })
    ).toBe('ALC-9: Fix the rail (ALC-9)')
  })

  // A ticket with no brief is ordinary. Three blank lines where the context would be is not.
  it('closes the hole a missing value leaves', () => {
    const brief = renderTaskBrief(DEFAULT_TASK_BRIEF_TEMPLATE, {
      ref: 'ALC-9',
      title: 'Fix the rail'
    })
    expect(brief).toContain('ALC-9 — Fix the rail')
    expect(brief).not.toMatch(/\n{3,}/)
    expect(brief.startsWith('ALC-9')).toBe(true)
  })

  it('leads with the task id and title, then its brief', () => {
    expect(
      renderTaskBrief(DEFAULT_TASK_BRIEF_TEMPLATE, {
        ref: 'PAY-142',
        title: 'Refund API',
        context: 'Partial amounts must write a ledger entry.'
      })
    ).toContain('PAY-142 — Refund API\n\nPartial amounts must write a ledger entry.')
  })

  it('tells the agent the branch is its call, because nothing was created for it', () => {
    const brief = renderTaskBrief(DEFAULT_TASK_BRIEF_TEMPLATE, { ref: 'PAY-7', title: 'x' })
    expect(brief).toContain('alicorn_* MCP tools')
    expect(brief).toContain('own branch or worktree')
  })

  // The domain is the part a repository cannot teach, so it has to survive into the brief.
  it('carries the project context under the ticket', () => {
    const brief = renderTaskBrief(DEFAULT_TASK_BRIEF_TEMPLATE, {
      ref: 'PAY-7',
      title: 'Refund API',
      project_context: 'Payments for a marketplace; sellers are paid out weekly.'
    })
    expect(brief).toContain('sellers are paid out weekly')
  })

  // An unknown placeholder is the author's typo, and silently eating it hides the typo.
  it('leaves a placeholder it does not know alone', () => {
    expect(renderTaskBrief('{{title}} {{nope}}', { title: 'x' })).toBe('x {{nope}}')
  })
})
