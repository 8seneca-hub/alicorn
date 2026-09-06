import { describe, expect, it } from 'vitest'
import type { RequiredCheck } from '@alicorn-cloud/control-plane-contract'
import { resolveRequiredChecks } from './required-checks-resolution.js'

const projectCheck: RequiredCheck = {
  kind: 'diff_coverage',
  threshold: 0.7,
  lcovPath: 'coverage/lcov.info',
  timeoutMs: 600_000
}
const stageCheck: RequiredCheck = { ...projectCheck, threshold: 0.9 }

describe('required checks resolution', () => {
  it('falls back to the project when there is no stage', () => {
    expect(resolveRequiredChecks(null, [projectCheck])).toEqual({ checks: [projectCheck], source: 'project' })
  })

  it('prefers the stage when it authors checks', () => {
    expect(resolveRequiredChecks([stageCheck], [projectCheck])).toEqual({ checks: [stageCheck], source: 'stage' })
  })

  it('treats an empty stage list as authored — no silent inheritance', () => {
    expect(resolveRequiredChecks([], [projectCheck])).toEqual({ checks: [], source: 'stage' })
  })

  it('resolves to nothing when neither scope authors checks', () => {
    expect(resolveRequiredChecks(null, [])).toEqual({ checks: [], source: 'project' })
  })
})
