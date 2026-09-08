import { JournalParseError } from './journal-types'

/**
 * The one table dialect every Foreman artefact on disk is written in.
 *
 * Shared because the journal and the reduced wave table have to agree on it: a lead reads both, and
 * a cell that escapes differently in one is a row that shifts every later column when it is read
 * back.
 */

// A cell that contained a pipe would silently split the row on the way back in.
export function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—'
}

export function uncell(value: string): string {
  const trimmed = value.replace(/\\\|/g, '|').trim()
  return trimmed === '—' ? '' : trimmed
}

export function list(values: readonly string[]): string {
  return values.length > 0 ? cell(values.join(', ')) : '—'
}

export function unlist(value: string): string[] {
  const raw = uncell(value)
  return raw
    ? raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

export function renderTable(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n')
}

// Splits on unescaped pipes only, so an escaped pipe inside a cell survives.
export function tableRows(body: string, section: string): string[][] {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
  if (lines.length === 0) {
    return []
  }
  return lines
    .slice(2)
    .map((line) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((value) => value)
    )
    .filter((row) => row.length > 1 || uncell(row[0] ?? '') !== '')
    .map((row) => {
      if (row.length < 2) {
        throw new JournalParseError(section, `row has too few columns: ${row.join('|')}`)
      }
      return row
    })
}
