/**
 * What a member should know about this project, rendered for `.alicorn/context.md`.
 *
 * It lives in an ignored directory rather than a tracked file at the repository root, because
 * using Alicorn should not mean committing to Alicorn — see `alicorn-project-dir.ts`. An earlier
 * design wrote `ALICORN.md` and an `@` import line into `CLAUDE.md`; both are files the team owns,
 * and both showed up in everyone's diff.
 *
 * **Static facts only.** Nothing here changes per task. A task's own stages, its autonomy level and
 * what it skips are per-session facts and ride in the system prompt instead — writing them here
 * would make the file a lie the moment a second task opened.
 *
 * Written between markers so a regeneration replaces its own block and never a hand-written line.
 */

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
