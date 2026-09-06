/**
 * Readable text from Plane's `description_html`.
 *
 * Why text and not rendered HTML: an issue description is user-authored content
 * from a remote server, and this codebase carries no HTML sanitiser. Parsing
 * into a detached document and reading `textContent` never executes anything —
 * rendering the markup would need a sanitiser first, which is a dependency
 * decision rather than a rendering one.
 */
export function planeDescriptionText(descriptionHtml: string): string {
  const trimmed = descriptionHtml.trim()
  if (!trimmed) {
    return ''
  }
  try {
    // Block-level tags carry the only line structure the text form can keep.
    // Paragraphs and headings read as separated blocks; list rows do not.
    const spaced = trimmed
      .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
      .replace(/<\/(li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
    const parsed = new DOMParser().parseFromString(spaced, 'text/html')
    return collapseBlankLines(parsed.body.textContent ?? '')
  } catch {
    return ''
  }
}

function collapseBlankLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
