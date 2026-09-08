import { describe, expect, it } from 'vitest'
import { organizationsFromClaim } from './keycloak-claims.js'

describe('organizationsFromClaim', () => {
  it('reads ids out of the object form', () => {
    expect(organizationsFromClaim({ acme: { id: 'org-1' }, beta: { id: 'org-2' } })).toEqual({
      resolved: [
        { id: 'org-1', alias: 'acme' },
        { id: 'org-2', alias: 'beta' }
      ],
      unresolvedAliases: []
    })
  })
  it('reports the array form as unresolved aliases', () => {
    expect(organizationsFromClaim(['acme'])).toEqual({ resolved: [], unresolvedAliases: ['acme'] })
  })
  it('treats an absent claim as no membership', () => {
    expect(organizationsFromClaim(undefined)).toEqual({ resolved: [], unresolvedAliases: [] })
  })
})
