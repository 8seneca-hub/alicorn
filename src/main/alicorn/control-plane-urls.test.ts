import { describe, expect, it } from 'vitest'
import { getAlicornControlPlaneUrls } from './control-plane-urls'

describe('getAlicornControlPlaneUrls', () => {
  it('reads both URLs from the environment', () => {
    expect(
      getAlicornControlPlaneUrls({
        ALICORN_CONTROL_API_URL: 'https://control.example.com',
        ALICORN_LEDGER_API_URL: 'https://ledger.example.com'
      })
    ).toEqual({
      controlApiUrl: 'https://control.example.com',
      ledgerApiUrl: 'https://ledger.example.com'
    })
  })

  it('defaults the ledger URL to the control URL', () => {
    expect(
      getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: 'http://127.0.0.1:8787' })
    ).toEqual({
      controlApiUrl: 'http://127.0.0.1:8787',
      ledgerApiUrl: 'http://127.0.0.1:8787'
    })
  })

  it('falls back to the control URL when the ledger URL is invalid', () => {
    expect(
      getAlicornControlPlaneUrls({
        ALICORN_CONTROL_API_URL: 'http://127.0.0.1:8787',
        ALICORN_LEDGER_API_URL: 'not a url'
      })?.ledgerApiUrl
    ).toBe('http://127.0.0.1:8787')
  })

  it('strips trailing slashes so paths are appended cleanly', () => {
    expect(
      getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: 'https://control.example.com///' })
    ).toEqual({
      controlApiUrl: 'https://control.example.com',
      ledgerApiUrl: 'https://control.example.com'
    })
  })

  it('returns null when the control URL is missing, blank or unparseable', () => {
    expect(getAlicornControlPlaneUrls({})).toBeNull()
    expect(getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: '   ' })).toBeNull()
    expect(getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: 'not a url' })).toBeNull()
  })

  it('returns null for a non-http scheme', () => {
    expect(
      getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: 'ftp://control.example.com' })
    ).toBeNull()
    expect(getAlicornControlPlaneUrls({ ALICORN_CONTROL_API_URL: 'file:///etc/passwd' })).toBeNull()
  })
})
