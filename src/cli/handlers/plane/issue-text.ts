// Plane stores issue and comment bodies as HTML. The CLI has no DOM, and a
// rendered-looking body is more useful to an agent than raw markup, so tags are
// stripped and the handful of entities Plane emits are decoded.
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

export function planeHtmlToText(html: string): string {
  // Block closes end a paragraph, list items end a line: a nested <div><p>
  // must not read as two blank lines, and a list must not be double-spaced.
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6])\s*>/gi, '\n\n')
    .replace(/<\s*li\s*>/gi, '- ')
  const stripped = withBreaks.replace(/<[^>]*>/g, '')
  const decoded = stripped.replace(
    /&[a-z#0-9]+;/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity
  )
  return decoded
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
