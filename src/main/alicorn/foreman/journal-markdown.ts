import {
  JournalParseError,
  type Journal,
  type JournalAssumption,
  type JournalDecision,
  type JournalLogEntry,
  type JournalNode,
  type JournalNodeStatus,
  type JournalStatus
} from './journal-types'

const NODE_STATUSES: JournalNodeStatus[] = ['pending', 'dispatched', 'done', 'failed', 'blocked']
const JOURNAL_STATUSES: JournalStatus[] = [
  'planning',
  'running',
  'paused',
  'blocked',
  'done',
  'failed'
]

// A cell that contained a pipe would silently split the row on the way back in.
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—'
}

function uncell(value: string): string {
  const trimmed = value.replace(/\\\|/g, '|').trim()
  return trimmed === '—' ? '' : trimmed
}

function list(values: readonly string[]): string {
  return values.length > 0 ? cell(values.join(', ')) : '—'
}

function unlist(value: string): string[] {
  const raw = uncell(value)
  return raw
    ? raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

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

function table(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n')
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
    '## Decisions',
    table(
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
    table(
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
    table(
      ['Node', 'Title', 'Owner', 'Depends on', 'Status', 'Model', 'Dispatch'],
      journal.plan.map((n) => [
        cell(n.id),
        cell(n.title),
        cell(n.owner),
        list(n.dependsOn),
        n.status,
        n.model === null ? '—' : cell(n.model),
        n.dispatchId === null ? '—' : cell(n.dispatchId)
      ])
    ),
    '',
    '## Contract registry',
    journal.contractRegistry || '—',
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

// Splits on unescaped pipes only, so an escaped pipe inside a cell survives.
function tableRows(body: string, section: string): string[][] {
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
    dispatchId: uncell(row[6] ?? '') || null
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
    contractRegistry: registry === '—' ? '' : registry,
    log: parseLog(markdown),
    notDone: bulletList(requireSection(markdown, 'Not done, and why'))
  }
}
