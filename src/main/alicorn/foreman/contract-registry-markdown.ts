import {
  emptyContractRegistry,
  isContractRegistryEmpty,
  type ContractEntry,
  type ContractGap,
  type ContractProvenance,
  type ContractRegistry
} from './contract-registry'
import { cell, renderTable, tableRows, uncell } from './markdown-table'

/**
 * The Contract Registry's spelling inside the journal's `## Contract registry` section.
 *
 * Split from `journal-markdown.ts` because the section has two tables and a prose block of its own,
 * and the journal file is already at the size where one more dialect stops being readable.
 */

const INTERFACES_HEADING = '### Interfaces'
const GAPS_HEADING = '### Schema generation required'

const INTERFACE_COLUMNS = [
  'Repo',
  'Kind',
  'Name',
  'Shape',
  'Provenance',
  'Source',
  'Breaking?'
] as const

const GAP_COLUMNS = ['Repo', 'Missing', 'Must be generated'] as const

// A column, not a comment: an entry a model asserted and an entry read out of a schema are
// different epistemic objects, and the reader has to be able to tell at a glance which is which.
const PROVENANCE_LABEL: Record<ContractProvenance, string> = {
  extracted: 'extracted',
  declared: '⚠ agent-declared'
}

function provenanceFrom(value: string): ContractProvenance {
  // Unrecognised reads as declared: under-trusting a row is recoverable, over-trusting one is not.
  return uncell(value).toLowerCase().includes('extract') ? 'extracted' : 'declared'
}

function interfaceRow(entry: ContractEntry): string[] {
  return [
    cell(entry.repo),
    cell(entry.kind),
    cell(entry.name),
    cell(entry.shape),
    PROVENANCE_LABEL[entry.provenance],
    cell(entry.source),
    entry.breaking ? 'yes' : 'no'
  ]
}

function gapRow(gap: ContractGap): string[] {
  return [cell(gap.repo), cell(gap.missing), cell(gap.generate)]
}

/** The section body only — `journal-markdown.ts` owns the `## Contract registry` heading itself. */
export function renderContractRegistry(registry: ContractRegistry): string {
  if (isContractRegistryEmpty(registry)) {
    return '—'
  }
  const blocks: string[] = []
  if (registry.notes) {
    blocks.push(registry.notes)
  }
  if (registry.entries.length > 0) {
    blocks.push(
      `${INTERFACES_HEADING}\n${renderTable(INTERFACE_COLUMNS, registry.entries.map(interfaceRow))}`
    )
  }
  if (registry.gaps.length > 0) {
    blocks.push(
      [
        GAPS_HEADING,
        '> Extraction found no schema in these repos. Entries for them can only be agent-declared',
        '> until what the last column names exists.',
        '',
        renderTable(GAP_COLUMNS, registry.gaps.map(gapRow))
      ].join('\n')
    )
  }
  return blocks.join('\n\n')
}

/** Everything before the first `###`, minus the empty-section placeholder. */
function notesOf(lines: readonly string[]): string {
  const end = lines.findIndex((line) => line.trim().startsWith('### '))
  const body = (end === -1 ? lines : lines.slice(0, end)).join('\n').trim()
  return body === '—' ? '' : body
}

function blockAfter(lines: readonly string[], heading: string): string | null {
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) {
    return null
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.trim().startsWith('### '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

function parseInterfaces(lines: readonly string[]): ContractEntry[] {
  const block = blockAfter(lines, INTERFACES_HEADING)
  if (block === null) {
    return []
  }
  return tableRows(block, 'Contract registry').map((row) => ({
    repo: uncell(row[0] ?? ''),
    kind: uncell(row[1] ?? ''),
    name: uncell(row[2] ?? ''),
    shape: uncell(row[3] ?? ''),
    provenance: provenanceFrom(row[4] ?? ''),
    source: uncell(row[5] ?? ''),
    breaking: uncell(row[6] ?? '').toLowerCase() === 'yes'
  }))
}

function parseGaps(lines: readonly string[]): ContractGap[] {
  const block = blockAfter(lines, GAPS_HEADING)
  if (block === null) {
    return []
  }
  return tableRows(block, 'Contract registry').map((row) => ({
    repo: uncell(row[0] ?? ''),
    missing: uncell(row[1] ?? ''),
    generate: uncell(row[2] ?? '')
  }))
}

/**
 * Reads the section back, tolerating a body that is nothing but prose.
 *
 * Journals written before CR1 — and any a lead types by hand from the template — carry free text
 * here. That text lands in `notes` and is rendered back out unchanged, because `updateRunJournal` is
 * read-modify-write: a section the parser cannot see is a section the next coordinator write erases.
 */
export function parseContractRegistry(body: string): ContractRegistry {
  const trimmed = body.trim()
  if (trimmed === '' || trimmed === '—') {
    return emptyContractRegistry()
  }
  const lines = trimmed.split('\n')
  return {
    entries: parseInterfaces(lines),
    gaps: parseGaps(lines),
    notes: notesOf(lines)
  }
}
