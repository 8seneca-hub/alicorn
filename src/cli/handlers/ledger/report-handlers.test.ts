import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, type RuntimeClient } from '../../runtime-client'
import type { InterruptionsReport } from '../../../shared/alicorn/ledger-report'
import { LEDGER_REPORT_HANDLERS } from './report-handlers'

const REPORT: InterruptionsReport = {
  filters: {},
  completedTasks: 2,
  interruptions: 3,
  perCompletedTask: 1.5,
  byKind: { gate: 2, ask: 1 },
  byStage: [
    { stageKey: 'build', completedTasks: 1, interruptions: 2, perCompletedTask: 2 },
    { stageKey: 'review', completedTasks: 1, interruptions: 1, perCompletedTask: 1 }
  ],
  excluded: ['permission_prompt']
}

function envelope(result: InterruptionsReport) {
  return { id: 'req-1', ok: true as const, result, _meta: { runtimeId: 'runtime-1' } }
}

describe('ledger report CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards flags to ledger.report', async () => {
    const call = vi.fn().mockResolvedValue(envelope(REPORT))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_REPORT_HANDLERS['ledger report']({
      flags: new Map([
        ['stage', 'build'],
        ['project', 'proj_1'],
        ['member', 'mem_1'],
        ['since', '2026-01-01T00:00:00.000Z'],
        ['until', '2026-02-01T00:00:00.000Z']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('ledger.report', {
      stageKey: 'build',
      projectId: 'proj_1',
      memberId: 'mem_1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z'
    })
  })

  it('prints the raw report as JSON with --json', async () => {
    const call = vi.fn().mockResolvedValue(envelope(REPORT))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_REPORT_HANDLERS['ledger report']({
      flags: new Map(),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, result: REPORT })
  })

  it('prints the headline, a per-stage table, and the excluded line in text mode', async () => {
    const call = vi.fn().mockResolvedValue(envelope(REPORT))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_REPORT_HANDLERS['ledger report']({
      flags: new Map(),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    const printed = String(log.mock.calls[0]?.[0])
    expect(printed).toContain('interruptions per completed task: 1.50 (3 / 2)')
    expect(printed).toContain('stage | completed | interruptions | per task')
    expect(printed).toContain('build | 1 | 2 | 2.00')
    expect(printed).toContain('review | 1 | 1 | 1.00')
    expect(printed).toContain('excluded: permission_prompt')
  })

  it('turns an unconfigured control plane into a one-line hint', async () => {
    const call = vi
      .fn()
      .mockRejectedValue(
        new RuntimeClientError('control_plane_unconfigured', 'control_plane_unconfigured')
      )

    await expect(
      LEDGER_REPORT_HANDLERS['ledger report']({
        flags: new Map(),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: false
      })
    ).rejects.toMatchObject({
      code: 'control_plane_unconfigured',
      message: expect.stringContaining('ALICORN_CONTROL_API_URL')
    })
  })
})
