import { describe, expect, it } from 'vitest'
import { planeHtmlToText } from './issue-text'

describe('planeHtmlToText', () => {
  it('turns paragraphs into blank-line-separated blocks', () => {
    expect(planeHtmlToText('<p>one</p><p>two</p>')).toBe('one\n\ntwo')
  })

  it('keeps a line break as a newline', () => {
    expect(planeHtmlToText('<p>one<br>two</p>')).toBe('one\ntwo')
  })

  it('marks list items so structure survives the strip', () => {
    expect(planeHtmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
  })

  it('decodes the entities Plane emits', () => {
    expect(planeHtmlToText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>')
  })

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(planeHtmlToText('<p>&hearts;</p>')).toBe('&hearts;')
  })

  it('collapses the run of blank lines a nested block leaves behind', () => {
    expect(planeHtmlToText('<div><p>a</p></div><div><p>b</p></div>')).toBe('a\n\nb')
  })

  it('returns an empty string for an empty body', () => {
    expect(planeHtmlToText('<p></p>')).toBe('')
  })
})
