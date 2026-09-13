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
  'member_rules',
  'workflow'
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
  '{{workflow}}',
  '',
  'You are working this task inside Alicorn. Use the alicorn_* MCP tools to record what you did and',
  'pull in whoever else it needs. Decide for yourself whether this needs its own branch or worktree',
  '— nothing has been created for you.'
].join('\n')

/**
 * The stages, and the rule about them.
 *
 * Spelled out in the brief rather than left to be discovered by refusal: an agent that learns the
 * pipeline by being told no wastes a turn and often argues. The refusal still stands on its own —
 * this is the courtesy, not the enforcement.
 */
export function describeWorkflowForBrief(args: {
  name: string
  stages: readonly { name: string; key: string }[]
  currentStageKey: string | null
}): string {
  if (args.stages.length === 0) {
    return ''
  }
  const rail = args.stages
    .map((stage) => (stage.key === args.currentStageKey ? `[${stage.name}]` : stage.name))
    .join(' → ')
  const at = args.currentStageKey ? `You are at the stage in brackets.` : `Nothing has started yet.`
  return [
    `Workflow: ${args.name}`,
    rail,
    at,
    'Advance with alicorn_advance_stage, one stage at a time. It refuses where the workflow gates —',
    'a merge, a deploy, anything irreversible or carrying inherited cost, and any stage this project',
    'has authored always_gate or has not authored a policy for. A refusal is final: ask the',
    'developer, and do not move the board yourself instead. Moving a column that skips a stage is',
    'refused too.'
  ].join('\n')
}

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
