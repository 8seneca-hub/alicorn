/**
 * `ALICORN.md` — what an agent should know about Alicorn before it is asked anything.
 *
 * A file imported by `CLAUDE.md` rather than a skill, and that is the whole design decision. A
 * skill's body loads only when the model decides the skill is relevant, which is a heuristic with a
 * documented failure rate; rules that must always hold cannot sit behind one. `CLAUDE.md` and its
 * `@` imports are expanded at session start, every time, which is the property we actually need.
 *
 * **Static facts only.** Nothing here changes per task. A task's own stages, its autonomy level and
 * what it skips are per-session facts and ride in the system prompt instead — writing them here
 * would make the file a lie the moment a second task opened, and rewriting it per session is
 * explicitly the wrong use of a memory file.
 *
 * Written between markers so a regeneration replaces its own block and never a hand-written line.
 */

export const ALICORN_MD_FILENAME = 'ALICORN.md'

/** The line that goes in CLAUDE.md. `@` import syntax: expanded at startup, four hops deep. */
export const ALICORN_MD_IMPORT = `@${ALICORN_MD_FILENAME}`

export const ALICORN_BLOCK_START = '<!-- alicorn:start -->'
export const ALICORN_BLOCK_END = '<!-- alicorn:end -->'

export type AlicornMdFacts = {
  projectName: string
  /** Member names and their backends, as the org library holds them. */
  members: readonly { name: string; role: string; backend: string }[]
  /** Stage names in order, for the project's default workflow. */
  stageNames: readonly string[]
}

export function renderAlicornMd(facts: AlicornMdFacts): string {
  const members = facts.members.length
    ? facts.members.map((m) => `- **${m.name}** — ${m.role}, runs on ${m.backend}`).join('\n')
    : '- None yet. Add one with `alicorn_create_member`.'
  const rail = facts.stageNames.length ? facts.stageNames.join(' → ') : 'No workflow yet.'
  return [
    ALICORN_BLOCK_START,
    '',
    '# Alicorn',
    '',
    `This repository is worked through Alicorn, an agent development environment. **${facts.projectName}**`,
    'is its project here.',
    '',
    '## These words mean Alicorn’s things',
    '',
    'Project, task, member, board, stage, workflow and autonomy refer to Alicorn’s own, reached only',
    'through the `alicorn_*` MCP tools. They are not Jira, Linear, Plane, Atlassian or GitHub objects,',
    'even when one of those servers is connected and offers a similarly named tool. Reach for another',
    'tracker only when the developer names it.',
    '',
    '## The workflow is a rule, not a diagram',
    '',
    `Default pipeline: ${rail}`,
    '',
    'A task that has a workflow advances **only** through `alicorn_advance_stage`, one stage at a',
    'time. It refuses where the workflow gates:',
    '',
    '- anything **irreversible** — a merge, a deploy. Hard stops never retire, whatever the record says.',
    '- anything carrying **inherited cost** — architecture, because everything built after it inherits the mistake.',
    '- any stage the project authored `always_gate` for, **or has not authored a policy for at all**.',
    '  The absence of a decision is not permission.',
    '',
    'A refusal is final. Ask the developer — do not move the board instead, and do not mark the stage',
    'unnecessary with `alicorn_skip_stage`, which refuses for the same reason.',
    '',
    '## Members',
    '',
    members,
    '',
    'Who works a task is decided from the brief and the org policy, not asked for. A reviewer never',
    'runs on the author’s backend, and a QA member never reads the implementation it is testing.',
    '',
    '## Every change answers with a receipt',
    '',
    'Each `alicorn_*` write returns what changed and how to undo it. Quote it back, so the developer',
    'can reverse anything you did without reading a transcript.',
    '',
    ALICORN_BLOCK_END,
    ''
  ].join('\n')
}

/** Replaces our block and leaves every hand-written line alone; appends when there is no block. */
export function upsertAlicornBlock(existing: string, block: string): string {
  const start = existing.indexOf(ALICORN_BLOCK_START)
  const end = existing.indexOf(ALICORN_BLOCK_END)
  if (start !== -1 && end !== -1 && end > start) {
    const after = end + ALICORN_BLOCK_END.length
    return `${existing.slice(0, start)}${block.trim()}${existing.slice(after)}`
  }
  return existing.trim() ? `${existing.trimEnd()}\n\n${block}` : block
}

/**
 * True when CLAUDE.md already pulls the file in.
 *
 * Backticked and fenced mentions are not imports — Claude Code skips both — so a document that
 * merely *talks* about `@ALICORN.md` must not be read as importing it. Getting this wrong is worse
 * than it looks: we would believe the import was already there and never write the real one.
 */
export function importsAlicornMd(claudeMd: string): boolean {
  let inFence = false
  for (const raw of claudeMd.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    if (line === ALICORN_MD_IMPORT || line.startsWith(`${ALICORN_MD_IMPORT} `)) {
      return true
    }
  }
  return false
}

/** The one line to add, under a marker so a later edit can find it again. */
export function addAlicornImport(claudeMd: string): string {
  if (importsAlicornMd(claudeMd)) {
    return claudeMd
  }
  const line = `${ALICORN_MD_IMPORT}\n`
  const note = `<!-- Added by Alicorn. Imported at session start; see ${ALICORN_MD_FILENAME}. -->\n`
  return claudeMd.trim() ? `${claudeMd.trimEnd()}\n\n${note}${line}` : `${note}${line}`
}
