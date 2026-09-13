/**
 * The GitHub repositories a released build may be published to and updated from.
 *
 * Two for two releases, and the order is the policy: an Alicorn build looks in the Alicorn
 * repository first, and falls back to the Alicorn one so a user who installed a pre-rebrand build
 * still receives the release that moves them across. Dropping the old owner immediately would
 * strand exactly the users the rebrand is trying to carry forward.
 *
 * The second entry retires once the first Alicorn-published release has itself been superseded,
 * because from then on nobody is updating *from* an Orca-published build.
 */
export const RELEASE_FEED_REPOSITORIES = ['8seneca-hub/alicorn', 'stablyai/orca'] as const

export type ReleaseFeedRepository = (typeof RELEASE_FEED_REPOSITORIES)[number]

/** Where this build publishes and looks first. */
export const PRIMARY_RELEASE_FEED_REPOSITORY: ReleaseFeedRepository = RELEASE_FEED_REPOSITORIES[0]

/**
 * Matches a release tag link from either owner's atom feed.
 *
 * Built rather than written out so a repository cannot be added to the list above and silently
 * left out of the parser — the defect would be a feed that reads as empty, which looks exactly
 * like "no update available".
 */
export function buildReleaseTagHrefPattern(): RegExp {
  const owners = RELEASE_FEED_REPOSITORIES.map((repo) => repo.replaceAll('/', '\\/')).join('|')
  return new RegExp(
    `href="https:\\/\\/github\\.com\\/(?:${owners})\\/releases\\/tag\\/([^"]+)"`,
    'g'
  )
}

export function releaseAtomFeedUrl(repository: ReleaseFeedRepository): string {
  return `https://github.com/${repository}/releases.atom`
}

export function releaseDownloadBaseUrl(repository: ReleaseFeedRepository): string {
  return `https://github.com/${repository}/releases/download`
}

export function latestReleaseDownloadUrl(repository: ReleaseFeedRepository): string {
  return `https://github.com/${repository}/releases/latest/download`
}
