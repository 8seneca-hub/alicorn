/**
 * The macOS bundle identifier the packaged app ships under.
 *
 * Keep this in step with `appId` in `local-build-compatibility-contract.json`
 * and `config/electron-builder.config.cjs`; `app-bundle-id.test.ts` pins them
 * together, because a drift between the packaged id and the id the app looks
 * for at runtime is invisible until someone's permissions silently reset.
 */
export const APP_BUNDLE_ID = 'com.8seneca.alicorn'

/**
 * The pre-rebrand identifier.
 *
 * Not dead weight: macOS keys per-bundle state off the id, so an upgrading
 * user's `defaults` domain and TCC grants still live under this one. Anything
 * that READS existing state must accept it; anything that declares our identity
 * must not. It retires when we stop supporting upgrades from Alicorn builds.
 */
export const LEGACY_APP_BUNDLE_ID = 'com.stablyai.orca'

/** Both identifiers plus their `.dev` / `.local` / `.helper` descendants. */
export function bundleIdWithVariants(bundleId: string): string[] {
  return [
    bundleId,
    `${bundleId}.helper`,
    `${bundleId}.dev`,
    `${bundleId}.dev.helper`,
    `${bundleId}.local`,
    `${bundleId}.local.helper`
  ]
}
