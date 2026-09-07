import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseJournal } from './journal'

// Why this exists: a lead writes the journal by hand from the template, and the coordinator reads it
// back with this parser. If the two drift, a hand-written journal stops loading — and the failure
// shows up as a lost run, not as a test.
const TEMPLATE = 'docs/alicorn/foreman-templates.md'

function journalTemplate(): string {
  const doc = readFileSync(TEMPLATE, 'utf8')
  const start = doc.indexOf('## 3 · Journal')
  expect(start).toBeGreaterThan(-1)
  const fence = doc.indexOf('```markdown', start)
  const end = doc.indexOf('```', fence + '```markdown'.length)
  return doc.slice(fence + '```markdown'.length, end).trim()
}

describe('the journal template in foreman-templates.md', () => {
  it('parses with the parser that reads real journals', () => {
    const journal = parseJournal(journalTemplate())
    expect(journal.plan.map((node) => node.status)).toEqual([
      'done',
      'dispatched',
      'dispatched',
      'pending'
    ])
  })

  it('keeps the documented node columns in the order the parser reads them', () => {
    const journal = parseJournal(journalTemplate())
    expect(journal.plan[0]).toMatchObject({
      id: '1',
      title: 'orient — map the area',
      owner: 'scout',
      model: 'haiku',
      dispatchId: 'ctx_1'
    })
    expect(journal.plan[3]).toMatchObject({ dependsOn: ['2', '3'], dispatchId: null })
  })

  it('documents a run status the parser accepts', () => {
    const doc = readFileSync(TEMPLATE, 'utf8')
    const statuses = /\*\*Status:\*\* ([^\n]+)/.exec(doc)?.[1] ?? ''
    for (const status of statuses.split('|').map((value) => value.trim())) {
      const rendered = journalTemplate().replace(/\*\*Status:\*\* [^\n]+/, `**Status:** ${status}`)
      expect(() => parseJournal(rendered)).not.toThrow()
    }
  })
})
