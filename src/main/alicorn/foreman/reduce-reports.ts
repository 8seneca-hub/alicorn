import type { ForemanReport } from '../../../shared/alicorn/foreman-report'
import type { JournalWaveOverlap } from './journal-types'
import { cell, renderTable } from './markdown-table'

/**
 * The reduce step of the diamond: fan out, reduce with code, synthesize.
 *
 * FM2 bounds one report; nothing bounded the sum, and context collapse is what kills a fleet. A
 * lead that reads N reports pays N × the ceiling, so a code step — no model — folds the wave into
 * one table and the lead reads that instead.
 *
 * This is the file most able to defeat its own purpose, so every cell is clamped and the table has
 * a ceiling of its own: the whole wave costs the lead what a *single* bounded report used to.
 */

/** One wave in a lead's window is worth one report's ceiling, not N of them. */
export const FOREMAN_WAVE_TABLE_MAX_TOKENS = 1500
export const FOREMAN_WAVE_TABLE_MAX_CHARS = FOREMAN_WAVE_TABLE_MAX_TOKENS * 4

// A three-sentence summary is already bounded at 600 chars; a wave of them is not, and the lead is
// deciding what to do next, not reading prose.
const SUMMARY_MAX_CHARS = 160
const SHARED_FILES_PER_ROW = 3

const TABLE_HEADER = [
  'Node',
  'Status',
  'Summary',
  'Changes',
  'Verification',
  'Open questions',
  'Cost in/out',
  'Shared files'
] as const

export type WaveReportEntry = { nodeId: string; report: ForemanReport }

export type ReducedWave = {
  /** One Markdown row per node, with the shared-file flag on the row that shares. */
  table: string
  overlaps: JournalWaveOverlap[]
  totals: { tokensIn: number | null; tokensOut: number | null }
}

function clamp(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Distinct paths one node reported changing. A node listing a path twice is one claim on it. */
function changedPaths(report: ForemanReport): string[] {
  return [...new Set(report.changes.map((change) => change.path.trim()).filter(Boolean))]
}

/** Paths present in two or more of the wave's reports — the overlap nobody declared up front. */
export function reportedFileOverlaps(entries: readonly WaveReportEntry[]): JournalWaveOverlap[] {
  const byPath = new Map<string, string[]>()
  for (const entry of entries) {
    for (const path of changedPaths(entry.report)) {
      const touchers = byPath.get(path)
      if (touchers) {
        touchers.push(entry.nodeId)
      } else {
        byPath.set(path, [entry.nodeId])
      }
    }
  }
  return [...byPath.entries()]
    .filter(([, nodeIds]) => nodeIds.length > 1)
    .map(([path, nodeIds]) => ({ path, nodeIds }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function sharedFilesCell(nodeId: string, overlaps: readonly JournalWaveOverlap[]): string {
  const mine = overlaps
    .filter((overlap) => overlap.nodeIds.includes(nodeId))
    .map((overlap) => overlap.path)
  if (mine.length === 0) {
    return '—'
  }
  const shown = mine.slice(0, SHARED_FILES_PER_ROW).join(', ')
  const rest = mine.length - SHARED_FILES_PER_ROW
  return cell(rest > 0 ? `⚠ ${shown} +${rest} more` : `⚠ ${shown}`)
}

function costCell(cost: ForemanReport['cost']): string {
  const render = (value: number | null): string => (value === null ? '—' : String(value))
  return `${render(cost.tokens_in)}/${render(cost.tokens_out)}`
}

/** Null only when no report in the wave reported a number; a partial wave still totals what it has. */
function total(
  entries: readonly WaveReportEntry[],
  key: 'tokens_in' | 'tokens_out'
): number | null {
  const known = entries
    .map((entry) => entry.report.cost[key])
    .filter((value): value is number => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
}

function row(entry: WaveReportEntry, overlaps: readonly JournalWaveOverlap[]): string[] {
  const { report } = entry
  return [
    cell(entry.nodeId),
    report.status,
    cell(clamp(report.summary, SUMMARY_MAX_CHARS)),
    String(report.changes.length),
    report.verification.result,
    String(report.open_questions.length),
    costCell(report.cost),
    sharedFilesCell(entry.nodeId, overlaps)
  ]
}

/**
 * Folds a settled wave into one table.
 *
 * Over the ceiling the table stops and says how many nodes it dropped rather than growing: the
 * journal's plan table already carries every node's status, so the lead loses a summary, never the
 * fact that a node exists. A wave that large is a decomposition to re-plan, and the truncation line
 * is how the lead finds out.
 */
export function reduceReports(
  entries: readonly WaveReportEntry[],
  opts: { maxChars?: number } = {}
): ReducedWave {
  const maxChars = opts.maxChars ?? FOREMAN_WAVE_TABLE_MAX_CHARS
  const overlaps = reportedFileOverlaps(entries)

  const kept: string[][] = []
  let dropped = 0
  for (const entry of entries) {
    const candidate = [...kept, row(entry, overlaps)]
    if (dropped === 0 && renderTable(TABLE_HEADER, candidate).length <= maxChars) {
      kept.push(row(entry, overlaps))
      continue
    }
    dropped++
  }

  const table = renderTable(TABLE_HEADER, kept)
  return {
    table:
      dropped === 0
        ? table
        : `${table}\n\n_${dropped} further node(s) omitted at the wave ceiling; their status is in the journal plan table._`,
    overlaps,
    totals: { tokensIn: total(entries, 'tokens_in'), tokensOut: total(entries, 'tokens_out') }
  }
}

/** The wave file as it lands on disk: a heading a lead can cite, the table, and the wave's spend. */
export function renderWaveFile(waveNumber: number, runId: string, reduced: ReducedWave): string {
  const tokens = (value: number | null): string => (value === null ? '—' : String(value))
  return [
    `# Wave ${waveNumber} — ${runId}`,
    '',
    'Reduced from the wave’s bounded reports by a code step. Read this, not the reports.',
    '',
    reduced.table,
    '',
    `**Wave tokens:** in ${tokens(reduced.totals.tokensIn)} / out ${tokens(reduced.totals.tokensOut)}`,
    '',
    ...(reduced.overlaps.length > 0
      ? [
          '## Files touched by more than one node',
          '',
          ...reduced.overlaps.map(
            (overlap) => `- \`${overlap.path}\` — nodes ${overlap.nodeIds.join(', ')}`
          ),
          ''
        ]
      : [])
  ].join('\n')
}
