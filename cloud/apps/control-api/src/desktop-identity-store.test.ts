import { describe, expect, it } from 'vitest'
import type { KeycloakAccessClaims } from '@alicorn-cloud/control-plane-auth'
import { NotAMemberError, createInProcessDesktopIdentityStore } from './desktop-identity-store.js'

function claims(overrides: Partial<KeycloakAccessClaims> = {}): KeycloakAccessClaims {
  return {
    sub: 'kc-sub-1',
    azp: 'alicorn-desktop',
    exp: Math.floor(Date.now() / 1000) + 300,
    email: 'dev@acme.test',
    name: 'Dev User',
    preferred_username: 'dev',
    organization: { acme: { id: 'org-acme' } },
    ...overrides
  }
}

describe('in-process desktop identity store', () => {
  it('derives the same user and profile id for the same subject in a fresh store', async () => {
    const a = await createInProcessDesktopIdentityStore().linkSession({ claims: claims() })
    const b = await createInProcessDesktopIdentityStore().linkSession({ claims: claims() })
    // Why this matters: the desktop signs the user out if either id moves, so a restart of the
    // control API must not reassign them.
    expect(a.userId).toBe(b.userId)
    expect(a.cloudProfileId).toBe(b.cloudProfileId)
    expect(a.userId).not.toBe(claims().sub)
  })

  it('gives different subjects different identities', async () => {
    const store = createInProcessDesktopIdentityStore()
    const a = await store.linkSession({ claims: claims() })
    const b = await store.linkSession({ claims: claims({ sub: 'kc-sub-2' }) })
    expect(a.userId).not.toBe(b.userId)
    expect(a.cloudProfileId).not.toBe(b.cloudProfileId)
  })

  it('falls back to the username then the subject when the realm grants no email', async () => {
    const store = createInProcessDesktopIdentityStore()
    expect((await store.linkSession({ claims: claims({ email: undefined }) })).email).toBe('dev')
    expect(
      (await store.linkSession({ claims: claims({ email: undefined, preferred_username: undefined }) })).email
    ).toBe('kc-sub-1')
  })

  it('picks a stable first organisation when nothing has been selected', async () => {
    const store = createInProcessDesktopIdentityStore()
    const record = await store.linkSession({
      claims: claims({ organization: { zulu: { id: 'org-z' }, acme: { id: 'org-a' } } })
    })
    expect(record.organizations.map((org) => org.name)).toEqual(['acme', 'zulu'])
    expect(record.activeOrgId).toBe('org-a')
  })

  it('refuses to select an organisation the token does not carry', async () => {
    const store = createInProcessDesktopIdentityStore()
    await store.linkSession({ claims: claims() })
    await expect(store.selectOrganization({ claims: claims(), orgId: 'org-other' })).rejects.toBeInstanceOf(
      NotAMemberError
    )
  })

  it('keeps a selected organisation only while the token still proves it', async () => {
    const store = createInProcessDesktopIdentityStore()
    const two = claims({ organization: { acme: { id: 'org-acme' }, globex: { id: 'org-globex' } } })
    await store.linkSession({ claims: two })
    expect((await store.selectOrganization({ claims: two, orgId: 'org-globex' })).activeOrgId).toBe('org-globex')
    expect((await store.resumeSession({ claims: two })).activeOrgId).toBe('org-globex')
    expect((await store.resumeSession({ claims: claims() })).activeOrgId).toBe('org-acme')
  })

  it('leaves the active organisation unset when the token carries none', async () => {
    const store = createInProcessDesktopIdentityStore()
    const record = await store.linkSession({ claims: claims({ organization: undefined }) })
    expect(record.organizations).toEqual([])
    expect(record.activeOrgId).toBeUndefined()
  })

  it('resolves an alias only once a token has proven what it maps to', async () => {
    const store = createInProcessDesktopIdentityStore()
    expect(await store.resolveOrgAliases(['acme'])).toEqual({})
    await store.linkSession({ claims: claims() })
    expect(await store.resolveOrgAliases(['acme', 'nope'])).toEqual({ acme: 'org-acme' })
  })
})
