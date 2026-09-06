// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { planeDescriptionText } from './plane-description-text'

describe('planeDescriptionText', () => {
  it('reads the text out of Plane markup', () => {
    expect(planeDescriptionText('<p>Goal: ship it</p>')).toBe('Goal: ship it')
  })

  it('keeps paragraph and list structure as line breaks', () => {
    expect(planeDescriptionText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo')
    expect(planeDescriptionText('<ul><li>a</li><li>b</li></ul>')).toBe('a\nb')
    expect(planeDescriptionText('a<br>b')).toBe('a\nb')
  })

  it('decodes entities rather than showing them raw', () => {
    expect(planeDescriptionText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>')
  })

  it('never yields executable markup', () => {
    // An issue description is user-authored content from a remote server, so
    // the tags must not survive into anything that could be rendered as HTML.
    const output = planeDescriptionText('<p>hi</p><script>alert(1)</script><img onerror="x">')
    expect(output).not.toContain('<script')
    expect(output).not.toContain('onerror')
    expect(output).toContain('hi')
  })

  it('is empty for an empty or blank description', () => {
    expect(planeDescriptionText('')).toBe('')
    expect(planeDescriptionText('   ')).toBe('')
    expect(planeDescriptionText('<p></p>')).toBe('')
  })
})
