/**
 * The first thing a member reads when a task is opened.
 *
 * A template rather than a fixed string, because what a team wants said to every agent is a team's
 * decision — and because the pieces it interpolates are the ones that are actually different per
 * ticket. `{{project_context}}` is why an imported project carries its board's description: the
 * underinformed member is the one the ledger cannot tell from a wrong one, and the domain is the
 * part a repository cannot teach.
 *
 * Substitution is deliberately dumb — no conditionals, no loops. A brief that needs a language is
 * a brief nobody can predict the output of, and this one is read by an agent that acts on it.
 */

export const TASK_BRIEF_PARAMS = [
  'ref',
  'title',
  'context',
  'project_context',
  'member_rules'
] as const
export type TaskBriefParam = (typeof TASK_BRIEF_PARAMS)[number]

/**
 * Ships working. Every line earns its place: the ticket, what is known about it, what the project
 * is for, and the two decisions the agent is expected to make for itself rather than ask about.
 */
export const DEFAULT_TASK_BRIEF_TEMPLATE = [
  '{{ref}} — {{title}}',
  '',
  '{{context}}',
  '',
  '{{project_context}}',
  '',
  '{{member_rules}}',
  '',
  'You are working this task inside Alicorn. Use the alicorn_* MCP tools to move it on the board,',
  'record what you did and pull in whoever else it needs. Decide for yourself whether this needs',
  'its own branch or worktree — nothing has been created for you.'
].join('\n')

/** A blank value takes its heading with it, so an empty brief does not leave a dangling label. */
export function renderTaskBrief(
  template: string,
  values: Partial<Record<TaskBriefParam, string>>
): string {
  const filled = TASK_BRIEF_PARAMS.reduce(
    (text, param) => text.replaceAll(`{{${param}}}`, (values[param] ?? '').trim()),
    template
  )
  // Collapse the holes a missing value leaves rather than shipping three blank lines mid-brief.
  return filled
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
