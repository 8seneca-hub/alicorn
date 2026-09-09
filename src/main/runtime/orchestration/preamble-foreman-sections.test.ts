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

const TEAM = {
  goal: 'Ship partial refunds',
  seats: [
    {
      role: 'developer' as const,
      stageKey: 'build',
      memberId: 'mem_dev',
      memberName: 'Ada',
      backend: 'claude' as const,
      acceptRate: 0.9,
      runs: 10,
      why: 'Best of 2 developers.'
    },
    {
      role: 'reviewer' as const,
      stageKey: 'review',
      memberId: null,
      memberName: null,
      backend: null,
      acceptRate: null,
      runs: null,
      why: 'Every reviewer runs on claude.'
    }
  ],
  gaps: ['Every reviewer runs on claude.']
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
      expect(text).toContain('ALICORN_ALICORN_STRATEGY=orchestrated')
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

    // AT1: the roster a human approved by name, inline. A lead that has to open a file to learn who
    // it may dispatch will get it wrong once.
    describe('with an approved team', () => {
      const withTeam = preamble({ foremanRole: 'lead', runId: 'run_1', approvedTeam: TEAM })

      it('names each approved member, its stage and the evidence behind it', () => {
        expect(withTeam).toContain('=== TEAM (APPROVED) ===')
        expect(withTeam).toContain('developer (stage "build"): Ada — member mem_dev on claude')
        expect(withTeam).toContain('Best of 2 developers.')
      })

      it('marks an unfilled seat as approved by nobody rather than leaving it blank', () => {
        expect(withTeam).toContain('reviewer (stage "review"): NOBODY APPROVED')
        expect(withTeam).toContain('Left open, and approved anyway:')
      })

      // The roster is who a human picked, not permission to skip anything they would have enforced.
      it('says the roster waives no check and no backend rule', () => {
        expect(withTeam).toContain('required\nchecks are authored on the stage')
        expect(withTeam).toContain('refused\nat launch')
      })
    })

    it('says nothing about a team when no composition was approved', () => {
      expect(text).not.toContain('=== TEAM (APPROVED) ===')
    })

    it('falls back to the task id when no run is named', () => {
      expect(preamble({ foremanRole: 'lead' })).toContain('.foreman/t1/journal.md')
    })
  })

  // RB2 — the learning edge reaching the splitter. A rule the worker reads and the planner does
  // not still produces the same decomposition mistake.
  describe('team rules', () => {
    const team = [
      { name: 'Ana', systemRules: 'Always run the migration before changing the schema type.' },
      { name: 'Bo', systemRules: '' },
      { name: 'Cy', systemRules: 'Never widen a public type without a deprecation.' }
    ]

    it('briefs the lead on every member that has rules, and omits the ones that do not', () => {
      const text = preamble({ foremanRole: 'lead', runId: 'run_alc42', teamRules: team })

      expect(text).toContain('=== TEAM RULES ===')
      expect(text).toContain('## Ana')
      expect(text).toContain('Always run the migration before changing the schema type.')
      expect(text).toContain('## Cy')
      expect(text).toContain('Never widen a public type without a deprecation.')
      expect(text).not.toContain('## Bo')
    })

    // A rule is a constraint added; a lead reading it as licence would be a member loosening the
    // criteria it is judged by, one indirection removed.
    it('says the rules constrain the plan rather than grant permission', () => {
      const text = preamble({ foremanRole: 'lead', teamRules: team })

      expect(text).toContain('constraints added, never permission granted')
      expect(text).toContain('a member never wrote')
    })

    it('renders no section for a team whose members have no rules', () => {
      const text = preamble({ foremanRole: 'lead', teamRules: [{ name: 'Bo', systemRules: '  ' }] })

      expect(text).not.toContain('=== TEAM RULES ===')
    })

    it('renders no section when no team is supplied', () => {
      expect(preamble({ foremanRole: 'lead' })).not.toContain('=== TEAM RULES ===')
    })

    // Foreman is an add-on: a single-agent dispatch pays nothing for it, and an orchestrated
    // worker is told its own rules by its dispatch, never the whole team's.
    it('never reaches a worker', () => {
      expect(preamble({ teamRules: team })).not.toContain('=== TEAM RULES ===')
      expect(preamble({ foremanRole: 'orchestrated-worker', teamRules: team })).not.toContain(
        '=== TEAM RULES ==='
      )
    })
  })
})
