import { describe, expect, it } from 'vitest'
import {
  DEEP_LINK_SCHEME,
  hasAcceptedDeepLinkPrefix,
  isAcceptedDeepLinkProtocol,
  LEGACY_DEEP_LINK_SCHEME
} from './deep-link-scheme'

describe('deep link schemes', () => {
  it('answers to the new scheme and the pre-rename one', () => {
    expect(DEEP_LINK_SCHEME).toBe('alicorn')
    expect(LEGACY_DEEP_LINK_SCHEME).toBe('orca')
    expect(isAcceptedDeepLinkProtocol('alicorn:')).toBe(true)
    expect(isAcceptedDeepLinkProtocol('orca:')).toBe(true)
  })

  // URL.protocol is already lowercased, but a raw pasted string is not.
  it('matches case-insensitively', () => {
    expect(isAcceptedDeepLinkProtocol('ALICORN:')).toBe(true)
    expect(hasAcceptedDeepLinkPrefix('ORCA://pair?code=x')).toBe(true)
  })

  it.each(['https:', 'file:', 'alicornx:', 'orcaide:'])('rejects %j', (protocol) => {
    expect(isAcceptedDeepLinkProtocol(protocol)).toBe(false)
  })

  it('requires the // separator on a prefix check', () => {
    expect(hasAcceptedDeepLinkPrefix('alicorn://pair')).toBe(true)
    expect(hasAcceptedDeepLinkPrefix('alicorn:pair')).toBe(false)
    expect(hasAcceptedDeepLinkPrefix('not-a-link')).toBe(false)
  })
})
