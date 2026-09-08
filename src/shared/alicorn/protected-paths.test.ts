import { describe, expect, it } from 'vitest'
import { resolveProtectedPathReach, type ProtectedPath } from './protected-paths'

const INFRA: ProtectedPath = { kind: 'path', path: 'infra', reason: 'production topology' }
const TERRAFORM: ProtectedPath = { kind: 'extension', extension: '.tf' }

describe('resolveProtectedPathReach', () => {
  it('answers false when the project protects nothing, even with nothing measured', () => {
    // Why this matters: without it BR1 would turn every gate on every project that has authored
    // no surface into an `unverified`.
    expect(resolveProtectedPathReach(null, [])).toEqual({ touched: false })
  })

  it('answers null — not false — when a surface is authored and the files could not be read', () => {
    const reach = resolveProtectedPathReach(null, [INFRA])
    expect(reach.touched).toBeNull()
  })

  it('answers false when the run stayed clear of the surface', () => {
    expect(resolveProtectedPathReach(['src/a.ts', 'README.md'], [INFRA])).toEqual({
      touched: false
    })
  })

  it('matches a directory rule on a segment boundary, not a string prefix', () => {
    expect(resolveProtectedPathReach(['infrastructure/notes.md'], [INFRA])).toEqual({
      touched: false
    })
    const reach = resolveProtectedPathReach(['infra/prod/main.tf'], [INFRA])
    expect(reach).toMatchObject({ touched: true })
    expect(reach.touched === true && reach.matches[0]?.rule).toEqual(INFRA)
  })

  it('matches the protected file itself', () => {
    expect(
      resolveProtectedPathReach(['src/keys.ts'], [{ kind: 'path', path: 'src/keys.ts' }])
    ).toMatchObject({ touched: true })
  })

  it('folds case on every platform, so Infra/ cannot slip past infra', () => {
    expect(resolveProtectedPathReach(['Infra/Prod/Main.TF'], [INFRA])).toMatchObject({
      touched: true
    })
  })

  it('accepts Windows separators on both sides', () => {
    expect(
      resolveProtectedPathReach(['infra\\prod\\main.tf'], [{ kind: 'path', path: 'infra\\prod' }])
    ).toMatchObject({ touched: true })
  })

  it('matches an extension rule anywhere, with or without the authored dot', () => {
    expect(resolveProtectedPathReach(['deploy/stack.tf'], [TERRAFORM])).toMatchObject({
      touched: true
    })
    expect(
      resolveProtectedPathReach(['deploy/stack.tf'], [{ kind: 'extension', extension: 'tf' }])
    ).toMatchObject({ touched: true })
    expect(resolveProtectedPathReach(['deploy/stack.tfvars'], [TERRAFORM])).toEqual({
      touched: false
    })
  })

  it('refuses to place a traversing or absolute path, and says so with null', () => {
    for (const path of ['../infra/main.tf', '/etc/passwd', 'C:\\Windows\\system32']) {
      expect(resolveProtectedPathReach([path], [INFRA]).touched).toBeNull()
    }
  })

  it('reads an unusable rule as unknown, never as an empty surface', () => {
    expect(
      resolveProtectedPathReach(['src/a.ts'], [{ kind: 'path', path: '../..' }]).touched
    ).toBeNull()
    expect(
      resolveProtectedPathReach(['src/a.ts'], [{ kind: 'extension', extension: '.' }]).touched
    ).toBeNull()
  })

  it('reports every reached path so the human at the gate can see all of them', () => {
    const reach = resolveProtectedPathReach(
      ['infra/a.tf', 'src/b.ts', 'deploy/c.tf'],
      [INFRA, TERRAFORM]
    )
    expect(reach.touched === true && reach.matches.map((match) => match.path)).toEqual([
      'infra/a.tf',
      'deploy/c.tf'
    ])
  })
})
