import { describe, expect, it } from 'vitest'
import { parseSkillShareId } from './skill-share-link'

describe('parseSkillShareId', () => {
  it('takes a bare share id', () => {
    expect(parseSkillShareId('  abc-123_XYZ  ')).toBe('abc-123_XYZ')
  })

  it('takes a share link under either scheme', () => {
    expect(parseSkillShareId('alicorn://skills/share/abc123')).toBe('abc123')
    expect(parseSkillShareId('orca://skills/share/abc123')).toBe('abc123')
  })

  it('takes a production https link', () => {
    expect(parseSkillShareId('https://app.orca.dev/skills/share/abc123')).toBe('abc123')
  })

  it.each([
    'https://evil.example/skills/share/abc123',
    'alicorn://skills/abc123',
    'http://app.orca.dev/skills/share/abc123',
    'not a link at all!'
  ])('rejects %j', (value) => {
    expect(parseSkillShareId(value)).toBeNull()
  })
})
