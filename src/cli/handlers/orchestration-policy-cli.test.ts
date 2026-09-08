import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }))

vi.mock('../runtime-client', async () => {
  // Why: re-export the REAL error classes so format.ts `instanceof` narrowing still matches.
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('../runtime/types.js')
  class RuntimeClient {
    readonly isRemote = false
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()
  }
  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError,
    serveOrcaApp: vi.fn(),
    getDefaultUserDataPath: vi.fn(() => '/tmp/orca-user-data')
  }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const POLICY = {
  stageKey: 'build',
  memberId: null,
  mode: 'evidence',
  minRuns: 10,
  minAcceptRate: 0.9,
  maxFiles: null,
  maxSpendCents: null,
  createdBy: 'actor',
  expiresAt: null
}

describe('orchestration policy commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = 0
  })

  const paramsFor = (method: string): Record<string, unknown> =>
    callMock.mock.calls.find((call) => call[0] === method)?.[1] as Record<string, unknown>

  const printed = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n')

  it('marks an unauthored policy as the default and shows the stage attributes', async () => {
    queueFixtures(
      callMock,
      okFixture('req_get', {
        policy: POLICY,
        authored: false,
        stageConfig: { reversibility: 'irreversible', inheritedCost: 'high' }
      })
    )

    await main(['orchestration', 'policy-get', '--project', 'repo-1'], '/tmp/repo')

    expect(process.exitCode).toBe(0)
    expect(printed()).toContain('[default, unauthored]')
    expect(printed()).toContain('stage irreversible, inherited cost high')
  })

  it('sends numeric budgets as numbers, not strings', async () => {
    queueFixtures(callMock, okFixture('req_set', { policy: { ...POLICY, maxFiles: 20 } }))

    await main(
      [
        'orchestration',
        'policy-set',
        '--project',
        'repo-1',
        '--mode',
        'evidence',
        '--min-runs',
        '20',
        '--min-accept-rate',
        '0.95',
        '--max-files',
        '20',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(process.exitCode).toBe(0)
    expect(paramsFor('orchestration.policySet')).toEqual(
      expect.objectContaining({
        project: 'repo-1',
        mode: 'evidence',
        minRuns: 20,
        minAcceptRate: 0.95,
        maxFiles: 20
      })
    )
  })

  it('fails on a non-numeric budget rather than dropping it silently', async () => {
    await main(
      [
        'orchestration',
        'policy-set',
        '--project',
        'repo-1',
        '--mode',
        'evidence',
        '--max-files',
        'lots'
      ],
      '/tmp/repo'
    )

    expect(process.exitCode).not.toBe(0)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('renders lapsed and standing exceptions in the audit view', async () => {
    queueFixtures(
      callMock,
      okFixture('req_list', {
        policies: [POLICY, { ...POLICY, stageKey: 'review', mode: 'never_gate' }],
        exceptions: [
          {
            stageKey: 'review',
            memberId: null,
            createdBy: 'admin',
            expiresAt: '2026-12-01T00:00:00.000Z',
            lapsed: false
          },
          {
            stageKey: 'test',
            memberId: 'm1',
            createdBy: 'admin',
            expiresAt: '2020-01-01T00:00:00.000Z',
            lapsed: true
          }
        ],
        standingExceptions: 1
      })
    )

    await main(['orchestration', 'policy-list', '--project', 'repo-1'], '/tmp/repo')

    expect(printed()).toContain('1 standing never_gate exception(s):')
    expect(printed()).toContain('review (every member) by admin until 2026-12-01T00:00:00.000Z')
    expect(printed()).toContain('[lapsed]')
  })

  it('says what the policy would decide without resolving anything', async () => {
    queueFixtures(
      callMock,
      okFixture('req_evidence', {
        memberId: 'm1',
        trackRecord: { runs: 12, acceptRate: 0.92, recentRegression: false, level: 1 },
        wouldDecide: { decision: 'gate', reason: 'accept-rate' }
      })
    )

    await main(['orchestration', 'evidence', '--task', 'task_1'], '/tmp/repo')

    expect(printed()).toContain('12 run(s), accept 0.92, level 1')
    expect(printed()).toContain('Policy would gate (accept-rate)')
    expect(callMock).toHaveBeenCalledTimes(1)
  })

  it('is explicit when a task has no member to have a track record', async () => {
    queueFixtures(
      callMock,
      okFixture('req_evidence', {
        memberId: null,
        trackRecord: null,
        wouldDecide: { decision: 'gate', reason: 'history' }
      })
    )

    await main(['orchestration', 'evidence', '--task', 'task_1'], '/tmp/repo')

    expect(printed()).toContain('no track record (no member recorded for this task)')
  })
})
