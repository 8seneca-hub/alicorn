import { describe, expect, it } from 'vitest'

import { readAlicornEnv, withLegacyEnvAliases } from './alicorn-env-compat'

describe('readAlicornEnv', () => {
  it('prefers the new name', () => {
    expect(readAlicornEnv({ ALICORN_ROLE: 'lead', ORCA_ROLE: 'stale' }, 'ALICORN_ROLE')).toBe(
      'lead'
    )
  })

  // The whole reason the shim exists: a hook or PTY started by the previous release.
  it('falls back to the pre-rebrand name', () => {
    expect(readAlicornEnv({ ORCA_ROLE: 'lead' }, 'ALICORN_ROLE')).toBe('lead')
  })

  it('is undefined when neither name is set', () => {
    expect(readAlicornEnv({}, 'ALICORN_ROLE')).toBeUndefined()
  })

  // Cleared is a value, not an absence — otherwise clearing a var resurrects the old one.
  it('lets an explicitly empty new name win over a set legacy name', () => {
    expect(readAlicornEnv({ ALICORN_ROLE: '', ORCA_ROLE: 'lead' }, 'ALICORN_ROLE')).toBe('')
  })

  it('translates only the prefix, not every occurrence of it', () => {
    expect(readAlicornEnv({ ORCA_ALICORN_HOME: 'x' }, 'ALICORN_ALICORN_HOME')).toBe('x')
  })
})

describe('withLegacyEnvAliases', () => {
  it('adds the legacy spelling of every new name', () => {
    expect(
      withLegacyEnvAliases({ ALICORN_ROLE: 'lead', ALICORN_STRATEGY: 'orchestrated' })
    ).toEqual({
      ALICORN_ROLE: 'lead',
      ALICORN_STRATEGY: 'orchestrated',
      ORCA_ROLE: 'lead',
      ORCA_STRATEGY: 'orchestrated'
    })
  })

  it('passes unrelated keys through untouched', () => {
    expect(withLegacyEnvAliases({ PATH: '/usr/bin', HOME: '/root' })).toEqual({
      PATH: '/usr/bin',
      HOME: '/root'
    })
  })

  // An explicit legacy value is a deliberate override; the alias must not become the authority.
  it('does not overwrite a legacy name the caller set itself', () => {
    expect(withLegacyEnvAliases({ ALICORN_ROLE: 'lead', ORCA_ROLE: 'pinned' })).toEqual({
      ALICORN_ROLE: 'lead',
      ORCA_ROLE: 'pinned'
    })
  })

  it('does not mutate its input', () => {
    const env = { ALICORN_ROLE: 'lead' }
    withLegacyEnvAliases(env)
    expect(env).toEqual({ ALICORN_ROLE: 'lead' })
  })

  it('is idempotent, so wrapping an already-aliased env changes nothing', () => {
    const once = withLegacyEnvAliases({ ALICORN_ROLE: 'lead' })
    expect(withLegacyEnvAliases(once)).toEqual(once)
  })
})
