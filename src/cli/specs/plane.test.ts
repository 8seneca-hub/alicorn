import { describe, expect, it } from 'vitest'
import { GLOBAL_FLAGS } from '../args'
import { PLANE_COMMAND_SPECS } from './plane'

const byPath = new Map(PLANE_COMMAND_SPECS.map((spec) => [spec.path.join(' '), spec]))

describe('PLANE_COMMAND_SPECS', () => {
  it('declares the four verbs the skill guide documents', () => {
    expect([...byPath.keys()].sort()).toEqual([
      'plane comment',
      'plane issue',
      'plane search',
      'plane state'
    ])
  })

  it('carries the global flags on every verb', () => {
    for (const spec of PLANE_COMMAND_SPECS) {
      for (const flag of GLOBAL_FLAGS) {
        expect(spec.allowedFlags).toContain(flag)
      }
    }
  })

  // Why: the positional is delivered through the flag map, so a verb taking an
  // issue id must allow `id` or the parser drops it.
  it('allows the id flag on every verb that takes an issue positional', () => {
    for (const spec of PLANE_COMMAND_SPECS) {
      if (spec.positionalArgs?.includes('id')) {
        expect(spec.allowedFlags).toContain('id')
      }
    }
  })

  it('requires a project on search, because Plane has no cross-project list', () => {
    const spec = byPath.get('plane search')
    expect(spec?.usage).toContain('--project <id>')
    expect(spec?.allowedFlags).toContain('project')
    expect(spec?.positionalArgs ?? []).toEqual([])
  })

  it('takes the comment body as a flag rather than a second positional', () => {
    expect(byPath.get('plane comment')?.allowedFlags).toContain('body')
  })

  it('names the destination state with --to', () => {
    expect(byPath.get('plane state')?.allowedFlags).toContain('to')
  })

  it('gives every verb a usage line and at least one example', () => {
    for (const spec of PLANE_COMMAND_SPECS) {
      expect(spec.usage).toMatch(/^orca plane /)
      expect(spec.examples?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('documents that a uuid needs a project', () => {
    expect(byPath.get('plane issue')?.notes?.join(' ')).toContain('--project')
  })
})
