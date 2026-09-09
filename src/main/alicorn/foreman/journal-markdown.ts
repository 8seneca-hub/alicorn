import {
  JournalParseError,
  type Journal,
  type JournalAssumption,
  type JournalDecision,
  type JournalLogEntry,
  type JournalNode,
  type JournalNodeStatus,
  type JournalStatus,
  type JournalWave,
  type JournalWaveOverlap
} from './journal-types'
import { parseContractRegistry, renderContractRegistry } from './contract-registry-markdown'
import { parseJournalTeam, renderJournalTeam } from './composed-team-markdown'
import { cell, list, renderTable, tableRows, uncell, unlist } from './markdown-table'

const NODE_STATUSES: JournalNodeStatus[] = ['pending', 'dispatched', 'done', 'failed', 'blocked']
const JOURNAL_STATUSES: JournalStatus[] = [
  'planning',
  'running',
  'paused',
  'blocked',
  'done',
  'failed'
]

function money(cents: number | null): string {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`
}

function unmoney(value: string, section: string): number | null {
  const raw = uncell(value)
  if (!raw) {
    return null
  }
  const parsed = Number(raw.replace(/^\$/, ''))
  if (!Number.isFinite(parsed)) {
    throw new JournalParseError(section, `expected a money value, got "${raw}"`)
  }
  return Math.round(parsed * 100)
}

// `path → a, b`, joined with `; `. A path cannot contain an arrow, which is what makes the pair
// separable again; pipes are already escaped by `cell`.
function renderOverlaps(overlaps: readonly JournalWaveOverlap[]): string {
  return overlaps.length > 0
    ? cell(overlaps.map((o) => `${o.path} → ${o.nodeIds.join(', ')}`).join('; '))
    : '—'
}

function parseOverlaps(value: string): JournalWaveOverlap[] {
  const raw = uncell(value)
  if (!raw) {
    return []
  }
  return raw
    .split(';')
    .map((entry) => entry.split('→'))
    .filter((parts) => parts.length === 2)
    .map(([path, nodeIds]) => ({
      path: path!.trim(),
      nodeIds: unlist(nodeIds!)
    }))
    .filter((overlap) => overlap.path !== '')
}

export function renderJournal(journal: Journal): string {
  return [
    `# ${journal.runId}`,
    '',
    `**Status:** ${journal.status}`,
    `**Started:** ${journal.startedAt}   **Budget:** ${money(journal.budgetCents)}`,
    `**Spent so far:** ${money(journal.spentCents)}`,
    '',
    '## Objective',
    journal.objective || '—',
    '',
    '## Team',
    renderJournalTeam(journal.team),
    '',
    '## Decisions',
    renderTable(
      ['#', 'Decision', 'Chosen', 'Why', 'Reversible?'],
      journal.decisions.map((d) => [
        String(d.n),
        cell(d.decision),
        cell(d.chosen),
        cell(d.why),
        d.reversible ? 'yes' : 'no'
      ])
    ),
    '',
    '## Assumptions made without asking',
    renderTable(
      ['#', 'Assumption', 'Blast radius', 'Nodes depending on it'],
      journal.assumptions.map((a) => [
        String(a.n),
        cell(a.assumption),
        cell(a.blastRadius),
        list(a.dependents)
      ])
    ),
    '',
    '## Plan',
    renderTable(
      ['Node', 'Title', 'Owner', 'Depends on', 'Status', 'Model', 'Dispatch', 'Files'],
      journal.plan.map((n) => [
        cell(n.id),
        cell(n.title),
        cell(n.owner),
        list(n.dependsOn),
        n.status,
        n.model === null ? '—' : cell(n.model),
        n.dispatchId === null ? '—' : cell(n.dispatchId),
        list(n.files)
      ])
    ),
    '',
    '## Waves',
    renderTable(
      ['Wave', 'Nodes', 'Reduced', 'Overlapping files'],
      journal.waves.map((w) => [
        String(w.n),
        list(w.nodeIds),
        w.reducedPath === null ? '—' : cell(w.reducedPath),
        renderOverlaps(w.overlaps)
      ])
    ),
    '',
    '## Contract registry',
    renderContractRegistry(journal.contractRegistry),
    '',
    '## Log',
    ...(journal.log.length > 0
      ? journal.log.map((entry) => `- \`${entry.at}\` ${entry.line}`)
      : ['—']),
    '',
    '## Not done, and why',
    ...(journal.notDone.length > 0 ? journal.notDone.map((item) => `- ${item}`) : ['—']),
    ''
  ].join('\n')
}

function sectionBody(markdown: string, heading: string): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start === -1) {
    return null
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

function requireSection(markdown: string, heading: string): string {
  const body = sectionBody(markdown, heading)
  if (body === null) {
    throw new JournalParseError(heading, 'section is missing')
  }
  return body
}

function bulletList(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((item) => item !== '' && item !== '—')
}

function requireEnum<T extends string>(value: string, allowed: T[], section: string): T {
  const found = allowed.find((item) => item === value.trim())
  if (!found) {
    throw new JournalParseError(section, `expected one of ${allowed.join(', ')}, got "${value}"`)
  }
  return found
}

function field(markdown: string, label: string, section: string): string {
  const match = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^*\\n]*)`).exec(markdown)
  if (!match) {
    throw new JournalParseError(section, `missing **${label}:**`)
  }
  return match[1]!.trim()
}

function parseDecisions(markdown: string): JournalDecision[] {
  const section = 'Decisions'
  return tableRows(requireSection(markdown, section), section).map((row) => ({
    n: Number(uncell(row[0] ?? '')),
    decision: uncell(row[1] ?? ''),
    chosen: uncell(row[2] ?? ''),
    why: uncell(row[3] ?? ''),
    reversible: uncell(row[4] ?? '').toLowerCase() === 'yes'
  }))
}

function parseAssumptions(markdown: string): JournalAssumption[] {
  const section = 'Assumptions made without asking'
  return tableRows(requireSection(markdown, section), section).map((row) => ({
    n: Number(uncell(row[0] ?? '')),
    assumption: uncell(row[1] ?? ''),
    blastRadius: uncell(row[2] ?? ''),
    dependents: unlist(row[3] ?? '')
  }))
}

function parsePlan(markdown: string): JournalNode[] {
  const section = 'Plan'
  return tableRows(requireSection(markdown, section), section).map((row) => ({
    id: uncell(row[0] ?? ''),
    title: uncell(row[1] ?? ''),
    owner: uncell(row[2] ?? ''),
    dependsOn: unlist(row[3] ?? ''),
    status: requireEnum(uncell(row[4] ?? ''), NODE_STATUSES, section),
    model: uncell(row[5] ?? '') || null,
    dispatchId: uncell(row[6] ?? '') || null,
    files: unlist(row[7] ?? '')
  }))
}

// Optional on the way in, unlike every other section: `Waves` is derived from the plan and post-dates
// the first journals, so a run started before it — or a lead writing from the older template — must
// still load. It is rewritten from `planWaves` on the next journal write anyway.
function parseWaves(markdown: string): JournalWave[] {
  const section = 'Waves'
  const body = sectionBody(markdown, section)
  if (body === null) {
    return []
  }
  return tableRows(body, section).map((row) => ({
    n: Number(uncell(row[0] ?? '')),
    nodeIds: unlist(row[1] ?? ''),
    reducedPath: uncell(row[2] ?? '') || null,
    overlaps: parseOverlaps(row[3] ?? '')
  }))
}

function parseLog(markdown: string): JournalLogEntry[] {
  return bulletList(requireSection(markdown, 'Log')).map((item) => {
    const match = /^`([^`]*)`\s*(.*)$/.exec(item)
    return match ? { at: match[1]!, line: match[2]!.trim() } : { at: '', line: item }
  })
}

export function parseJournal(markdown: string): Journal {
  const heading = /^#\s+(\S+)/m.exec(markdown)
  if (!heading) {
    throw new JournalParseError('title', 'expected a `# <runId>` heading')
  }
  const objective = requireSection(markdown, 'Objective')
  const registry = requireSection(markdown, 'Contract registry')
  return {
    runId: heading[1]!,
    status: requireEnum(field(markdown, 'Status', 'header'), JOURNAL_STATUSES, 'header'),
    startedAt: field(markdown, 'Started', 'header'),
    budgetCents: unmoney(field(markdown, 'Budget', 'header'), 'header'),
    spentCents: unmoney(field(markdown, 'Spent so far', 'header'), 'header'),
    objective: objective === '—' ? '' : objective,
    decisions: parseDecisions(markdown),
    assumptions: parseAssumptions(markdown),
    plan: parsePlan(markdown),
    waves: parseWaves(markdown),
    contractRegistry: parseContractRegistry(registry),
    // Optional like `Waves`, and for the same reason: every journal written before AT1 has no
    // Team section, and a run with no composed team is the normal case rather than a broken one.
    team: parseJournalTeam(sectionBody(markdown, 'Team')),
    log: parseLog(markdown),
    notDone: bulletList(requireSection(markdown, 'Not done, and why'))
  }
}
