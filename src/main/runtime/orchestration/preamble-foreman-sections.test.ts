import { describe, expect, it } from 'vitest'
import { buildDispatchPreamble } from './preamble'
import { FOREMAN_REPORT_MAX_TOKENS } from '../../../shared/alicorn/foreman-report'

function preamble(overrides: Record<string, unknown> = {}): string {
  return buildDispatchPreamble({
    taskId: 't1',
    dispatchId: 'ctx_1',
    taskSpec: 'Build the endpoint.',
    coordinatorHandle: 'coord',
    workerHandle: 'term_a',
    ...overrides
  })
}

describe('foreman preamble sections', () => {
  // `single` is the default and stays the default: the schema is a cost only the runs that need it
  // pay, so an ordinary dispatch must gain nothing.
  it('adds nothing to a single-agent dispatch', () => {
    const text = preamble()

    expect(text).not.toContain('REPORT (ORCHESTRATED RUN)')
    expect(text).not.toContain('=== JOURNAL ===')
  })

  describe('orchestrated worker', () => {
    const text = preamble({ foremanRole: 'orchestrated-worker' })

    it('states the schema it will be held to', () => {
      expect(text).toContain('REPORT (ORCHESTRATED RUN)')
      expect(text).toContain('"status": "done | blocked | needs_decision | failed"')
      expect(text).toContain('interface_delta')
      expect(text).toContain('verification')
    })

    // Each of these is a rule the CLI enforces; stating it up front is what makes a rejection rare.
    it('states the ceiling, the spill path and the report-path conflict', () => {
      expect(text).toContain(String(FOREMAN_REPORT_MAX_TOKENS))
      expect(text).toContain('.foreman/<run-id>/<dispatch-id>-report.md')
      expect(text).toContain('--report-path')
    })

    it('names the rules a model reliably ignores', () => {
      expect(text).toContain('at most three sentences')
      expect(text).toContain('paths only, never file contents')
      expect(text).toContain('ONLY thing that crosses to another subagent')
      expect(text).toContain('is not `"passed"`')
    })

    it('names the env var that turns the schema on', () => {
      expect(text).toContain('ORCA_ALICORN_STRATEGY=orchestrated')
      expect(text).toContain('--orchestrated')
    })

    it('does not also hand a worker the lead journal instructions', () => {
      expect(text).not.toContain('=== JOURNAL ===')
    })
  })

  describe('lead', () => {
    const text = preamble({ foremanRole: 'lead', runId: 'run_alc42' })

    it('names the journal path for this run', () => {
      expect(text).toContain('.foreman/run_alc42/journal.md')
    })

    it('names every section the lead owns', () => {
      expect(text).toContain('Decisions')
      expect(text).toContain('Assumptions made without asking')
      expect(text).toContain('Contract registry')
      expect(text).toContain('Not done')
    })

    // The coordinator writes two columns; a lead that does not know which will either fight it or
    // stop filling the rest.
    it('says which plan columns Orca writes and which belong to the lead', () => {
      expect(text).toContain('Status and Dispatch columns')
      expect(text).toContain('Title, Owner, Depends on, Model and Files are yours')
    })

    it('restates the restriction that makes it a lead', () => {
      expect(text).toContain('write no code and read no implementation')
    })

    // A lead receives bounded reports; it does not send one.
    // Context collapse is the failure this exists to prevent: N bounded reports in one window is
    // not bounded, so the lead is pointed at the reduced table and told not to read the reports.
    it('points the lead at the reduced wave table rather than the reports', () => {
      expect(text).toContain('.foreman/run_alc42/wave-<n>.md')
      expect(text).toContain('Read that table, not')
      expect(text).toContain('the reports.')
    })

    it('tells the lead that declared files are what gets an overlap caught before dispatch', () => {
      expect(text).toContain('=== WAVES ===')
      expect(text).toContain('serialises them into')
      expect(text).toContain('successive waves')
    })

    it('does not also hand the lead the worker report schema', () => {
      expect(text).not.toContain('REPORT (ORCHESTRATED RUN)')
    })

    it('falls back to the task id when no run is named', () => {
      expect(preamble({ foremanRole: 'lead' })).toContain('.foreman/t1/journal.md')
    })
  })
})
