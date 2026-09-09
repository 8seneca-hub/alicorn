import { describe, expect, it } from 'vitest'
import { requiredCheckName } from './required-check-name'

describe('requiredCheckName', () => {
  it('puts an outcome-changing parameter in the name, so an old row reads as not run', () => {
    expect(
      requiredCheckName({ kind: 'diff_coverage', threshold: 0.8, lcovPath: 'l', timeoutMs: 1 })
    ).toBe('Diff coverage ≥ 80%')
    expect(
      requiredCheckName({ kind: 'diff_coverage', threshold: 0.9, lcovPath: 'l', timeoutMs: 1 })
    ).not.toBe('Diff coverage ≥ 80%')
  })

  it('names the one check a project can author only once', () => {
    expect(requiredCheckName({ kind: 'contract_acknowledged' })).toBe(
      'Breaking contracts acknowledged'
    )
  })

  it('distinguishes one repo from another (IV1 authors one check per repo)', () => {
    const api = requiredCheckName({ kind: 'integration_verify', command: 'c', repoId: 'repo-api' })
    expect(api).toBe('Integration verify (repo-api)')
    expect(
      requiredCheckName({ kind: 'integration_verify', command: 'c', repoId: 'repo-web' })
    ).not.toBe(api)
  })

  it('names a skill check by id, so a catalog rename does not orphan the row a gate reads', () => {
    expect(requiredCheckName({ kind: 'skill', skillId: 'sk-1' })).toBe('sk-1')
    expect(requiredCheckName({ kind: 'skill', skillId: 'sk-1', versionId: 'v2' })).toBe('sk-1@v2')
    expect(requiredCheckName({ kind: 'skill', skillId: 'sk-2' })).not.toBe('sk-1')
  })
})
