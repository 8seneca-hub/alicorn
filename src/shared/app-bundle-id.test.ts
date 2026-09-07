import { describe, expect, it } from 'vitest'
import { APP_BUNDLE_ID, bundleIdWithVariants, LEGACY_APP_BUNDLE_ID } from './app-bundle-id'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from './local-build-compatibility-contract'
import { readFileSync } from 'node:fs'

describe('app bundle identifier', () => {
  it('ships under the Alicorn id', () => {
    expect(APP_BUNDLE_ID).toBe('com.8seneca.alicorn')
    expect(LEGACY_APP_BUNDLE_ID).toBe('com.stablyai.orca')
  })

  // Three copies exist because the packager is CJS and cannot import TS. A drift
  // between them is invisible until a user's permissions silently reset, so pin it.
  it('matches both local-build contract mirrors', () => {
    expect(LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId).toBe(APP_BUNDLE_ID)
    // Read, not imported: the JSON is outside the CLI tsconfig's file list, and it
    // is the copy the CJS packager consumes.
    const contractJson = JSON.parse(
      readFileSync('src/shared/local-build-compatibility-contract.json', 'utf8')
    )
    expect(contractJson.appId).toBe(APP_BUNDLE_ID)
  })

  it('expands to the helper and channel identities macOS holds separately', () => {
    expect(bundleIdWithVariants('com.example.app')).toEqual([
      'com.example.app',
      'com.example.app.helper',
      'com.example.app.dev',
      'com.example.app.dev.helper',
      'com.example.app.local',
      'com.example.app.local.helper'
    ])
  })
})
