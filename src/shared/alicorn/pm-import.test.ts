import { describe, expect, it } from 'vitest'
import { htmlToPlainText, isOpenPlaneIssue, planeIssueToTask, planeProjectKey } from './pm-import'

const states = [
  { id: 'st-backlog', group: 'backlog' as const },
  { id: 'st-doing', group: 'started' as const },
  { id: 'st-done', group: 'completed' as const },
  { id: 'st-dropped', group: 'cancelled' as const }
]

describe('which issues are still work', () => {
  it('counts backlog and started as open', () => {
    expect(isOpenPlaneIssue({ stateId: 'st-backlog' }, states)).toBe(true)
    expect(isOpenPlaneIssue({ stateId: 'st-doing' }, states)).toBe(true)
  })

  it('counts completed and cancelled as finished', () => {
    expect(isOpenPlaneIssue({ stateId: 'st-done' }, states)).toBe(false)
    expect(isOpenPlaneIssue({ stateId: 'st-dropped' }, states)).toBe(false)
  })

  // Hiding work because a lookup failed is worse than one ticket too many.
  it('counts an unresolvable state as open', () => {
    expect(isOpenPlaneIssue({ stateId: 'st-unknown' }, states)).toBe(true)
    expect(isOpenPlaneIssue({ stateId: null }, states)).toBe(true)
  })
})

describe('the project key', () => {
  it('uses the PM project’s own identifier, which is already shaped like one', () => {
    expect(planeProjectKey('ALC', 'Alicorn Platform')).toBe('ALC')
  })

  it('falls back to the name when the identifier cannot be a key', () => {
    expect(planeProjectKey('123', 'Payments Platform')).toBe('PAYM')
  })

  it('answers empty when neither can be, so the field asks rather than guessing', () => {
    expect(planeProjectKey('1', 'X')).toBe('')
  })
})

describe('issue body to task context', () => {
  it('reads as prose, not markup', () => {
    expect(htmlToPlainText('<p>Stripe retries <b>3x</b>.</p><p>Do not double-refund.</p>')).toBe(
      'Stripe retries 3x.\n\nDo not double-refund.'
    )
  })

  it('decodes the entities a description actually carries', () => {
    expect(htmlToPlainText('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>')).toBe('a & b <c> "d"')
  })

  it('turns line breaks into lines', () => {
    expect(htmlToPlainText('one<br>two')).toBe('one\ntwo')
  })
})

describe('an imported task', () => {
  const issue = {
    id: 'issue-uuid',
    readableId: 'ALC-11',
    name: 'Refund API — partial refunds',
    descriptionHtml: '<p>Partial amounts must write a ledger entry.</p>',
    stateId: 'st-backlog'
  }

  it('keeps the issue’s human id so a re-import can recognise it', () => {
    expect(planeIssueToTask(issue).source).toEqual({
      provider: 'plane',
      ref: 'ALC-11',
      url: null
    })
  })

  it('lands in the first column as ordinary single-agent work', () => {
    const task = planeIssueToTask(issue)

    expect(task.column).toBe('todo')
    expect(task.executionStrategy).toBe('single')
    expect(task.title).toBe('Refund API — partial refunds')
    expect(task.context).toBe('Partial amounts must write a ledger entry.')
  })

  // Who works on a task is the project's answer, not the PM tool's.
  it('copies no assignee', () => {
    expect(planeIssueToTask(issue).memberIds).toEqual([])
  })

  it('links back to the issue when the board’s url is known', () => {
    expect(
      planeIssueToTask(issue, { projectUrl: 'https://plane.example/p/alc/' }).source?.url
    ).toBe('https://plane.example/p/alc/issue-uuid')
  })
})
