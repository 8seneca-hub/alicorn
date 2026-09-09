import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseJournal, renderJournal } from './journal'

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

  // The lead declares Files by hand from this template; the hidden-dependency check reads them.
  it('documents the Files column and the Waves the parser derives from it', () => {
    const journal = parseJournal(journalTemplate())
    expect(journal.plan[1]?.files).toEqual(['src/api/refunds.ts'])
    expect(journal.waves.map((wave) => wave.nodeIds)).toEqual([['1'], ['2', '3'], ['4']])
    expect(journal.waves[0]?.reducedPath).toBe('.foreman/run_alc42/wave-1.md')
  })

  // A lead pastes a registry row into a brief; if the documented columns drift from the parser's
  // order the pasted row is the wrong contract, which is worse than no registry at all.
  it('keeps the documented Contract Registry columns in the order the parser reads them', () => {
    const registry = parseJournal(journalTemplate()).contractRegistry
    expect(registry.entries).toEqual([
      {
        repo: '',
        kind: 'endpoint',
        name: 'POST /refunds/partial',
        shape: 'body PartialRefundRequest; → 201 Refund',
        provenance: 'extracted',
        source: 'openapi.yaml#/paths/~1refunds~1partial/post',
        breaking: false
      },
      {
        repo: '',
        kind: 'type',
        name: 'RefundState',
        shape: "type RefundState = 'pending' | 'settled'",
        provenance: 'declared',
        source: 'node 3',
        breaking: false
      }
    ])
    expect(registry.gaps).toEqual([
      {
        repo: 'billing',
        missing: 'no OpenAPI document and no shared contract types found',
        generate: 'an OpenAPI document for the HTTP surface, or exported types under contracts/'
      }
    ])
  })

  // The lead's own prose lives above the tables; a coordinator write must not eat it.
  it('keeps the documented prose out of the tables and round-trips it', () => {
    const template = journalTemplate()
    const registry = parseJournal(template).contractRegistry
    expect(registry.notes).toContain('agent-declared')
    expect(renderJournal(parseJournal(template)).includes(registry.notes)).toBe(true)
  })

  // AT1: the lead reads its approved roster out of this section, so the documented columns have to
  // be the ones the parser reads — a shifted column would name the wrong member for a seat.
  it('keeps the documented Team columns in the order the parser reads them', () => {
    const team = parseJournal(journalTemplate()).team
    expect(team?.gateId).toBe('gate_alc42')
    expect(
      team?.seats.map((seat) => [seat.role, seat.stageKey, seat.memberId, seat.backend])
    ).toEqual([
      ['developer', 'build', 'mem_dev1', 'claude'],
      ['reviewer', 'review', 'mem_rev1', 'codex'],
      ['qa', 'verify', null, null]
    ])
    expect(team?.seats[0]?.acceptRate).toBeCloseTo(0.92)
    expect(team?.seats[0]?.runs).toBe(24)
    expect(team?.gaps).toEqual([
      'No qa member exists in this organisation — add one, or run this stage yourself.'
    ])
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
