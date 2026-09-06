import { describe, expect, it } from 'vitest'
import { readAlicornBearer } from './control-plane-session'

const TOKEN = 'local-dev-token-0123456789'

describe('readAlicornBearer', () => {
  it('reads the token and tenant from the environment', () => {
    expect(
      readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN, ALICORN_TENANT_ID: 'tenant-1' })
    ).toEqual({ accessToken: TOKEN, orgId: 'tenant-1' })
  })

  it('defaults the org to local when no tenant is set', () => {
    expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN })?.orgId).toBe('local')
    expect(
      readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN, ALICORN_TENANT_ID: '  ' })?.orgId
    ).toBe('local')
  })

  it('rejects a token too short to be a real credential', () => {
    // A 5-char value is a placeholder or a truncated paste; failing here reads
    // as "not configured" instead of an unexplained 401 later.
    expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: 'short' })).toBeNull()
  })

  it('returns null when the token is missing or blank', () => {
    expect(readAlicornBearer({})).toBeNull()
    expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: '   ' })).toBeNull()
  })

  it('trims the token so a copied newline does not reach the header', () => {
    expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: `  ${TOKEN}\n` })?.accessToken).toBe(TOKEN)
  })
})
