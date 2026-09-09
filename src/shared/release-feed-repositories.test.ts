import { describe, expect, it } from 'vitest'
import {
  buildReleaseTagHrefPattern,
  latestReleaseDownloadUrl,
  PRIMARY_RELEASE_FEED_REPOSITORY,
  releaseAtomFeedUrl,
  releaseDownloadBaseUrl,
  RELEASE_FEED_REPOSITORIES
} from './release-feed-repositories'

describe('release feed repositories', () => {
  it('publishes to and reads the Alicorn repository first', () => {
    expect(PRIMARY_RELEASE_FEED_REPOSITORY).toBe('8seneca-hub/alicorn')
    expect(releaseAtomFeedUrl(PRIMARY_RELEASE_FEED_REPOSITORY)).toBe(
      'https://github.com/8seneca-hub/alicorn/releases.atom'
    )
    expect(releaseDownloadBaseUrl(PRIMARY_RELEASE_FEED_REPOSITORY)).toBe(
      'https://github.com/8seneca-hub/alicorn/releases/download'
    )
    expect(latestReleaseDownloadUrl(PRIMARY_RELEASE_FEED_REPOSITORY)).toBe(
      'https://github.com/8seneca-hub/alicorn/releases/latest/download'
    )
  })

  // The users this exists for: a build installed before the rebrand reads the Orca feed, and its
  // entries are what carry them across to the first Alicorn-published release.
  it('still parses a tag from the pre-rebrand owner', () => {
    const body = [
      '<link href="https://github.com/stablyai/orca/releases/tag/v1.4.197"/>',
      '<link href="https://github.com/8seneca-hub/alicorn/releases/tag/v1.5.0"/>'
    ].join('\n')

    expect([...body.matchAll(buildReleaseTagHrefPattern())].map((match) => match[1])).toEqual([
      'v1.4.197',
      'v1.5.0'
    ])
  })

  it('ignores a tag link from any other repository', () => {
    const body = '<link href="https://github.com/someone-else/orca/releases/tag/v9.9.9"/>'

    expect([...body.matchAll(buildReleaseTagHrefPattern())]).toEqual([])
  })

  // A stateful global regex shared across calls skips every other match on the second read, and
  // the symptom is an update feed that intermittently looks empty.
  it('hands out a fresh pattern each call, so a second read sees every entry', () => {
    const body = '<link href="https://github.com/8seneca-hub/alicorn/releases/tag/v1.5.0"/>'

    expect([...body.matchAll(buildReleaseTagHrefPattern())]).toHaveLength(1)
    expect([...body.matchAll(buildReleaseTagHrefPattern())]).toHaveLength(1)
  })

  it('keeps every listed repository in the parser, so adding one cannot be half-done', () => {
    const pattern = buildReleaseTagHrefPattern()
    for (const repository of RELEASE_FEED_REPOSITORIES) {
      expect(`href="https://github.com/${repository}/releases/tag/v1.0.0"`).toMatch(
        new RegExp(pattern.source)
      )
    }
  })
})
