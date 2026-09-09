import { describe, expect, it } from 'vitest'
import { RequiredCheckSchema, RequiredChecksSchema } from './index.js'

describe('integration_verify required check', () => {
  it('carries the command and the repo whose workspace hosts it', () => {
    expect(
      RequiredCheckSchema.parse({
        kind: 'integration_verify',
        command: '  pnpm run test:integration  ',
        repoId: ' repo-api '
      })
    ).toEqual({
      kind: 'integration_verify',
      command: 'pnpm run test:integration',
      repoId: 'repo-api'
    })
  })

  it('rejects an empty command or repo — a check nobody can run is not a check', () => {
    const base = { kind: 'integration_verify', command: 'make e2e', repoId: 'repo-api' }
    expect(RequiredCheckSchema.safeParse({ ...base, command: '   ' }).success).toBe(false)
    expect(RequiredCheckSchema.safeParse({ ...base, repoId: '' }).success).toBe(false)
  })

  it('caps the command so a project cannot author a script into the policy row', () => {
    const command = 'x'.repeat(501)
    expect(
      RequiredCheckSchema.safeParse({ kind: 'integration_verify', command, repoId: 'r' }).success
    ).toBe(false)
  })

  it('has no timeout knob — the ceiling is the evaluator, not a criterion to argue with', () => {
    const parsed = RequiredCheckSchema.parse({
      kind: 'integration_verify',
      command: 'make e2e',
      repoId: 'repo-api'
    })
    expect(parsed).not.toHaveProperty('timeoutMs')
  })

  it('is authored once per repo alongside the other kinds', () => {
    const checks = RequiredChecksSchema.parse([
      { kind: 'diff_coverage', threshold: 0.8 },
      { kind: 'integration_verify', command: 'make e2e', repoId: 'repo-api' },
      { kind: 'integration_verify', command: 'make e2e', repoId: 'repo-web' }
    ])
    expect(checks.map((check) => check.kind)).toEqual([
      'diff_coverage',
      'integration_verify',
      'integration_verify'
    ])
  })
})
