/**
 * What every Alicorn session is told about where it is standing.
 *
 * A system prompt rather than a first message: it has to reach the model without appearing in the
 * transcript as something the developer typed, and it has to survive a conversation long enough to
 * forget its opening turn.
 *
 * **It exists because MCP `instructions` were not enough.** A session carries whatever servers the
 * developer has configured, and a question like "how many members are in this project?" matches a
 * Jira or Atlassian tool as readily as Alicorn's own — "project" and "member" are that generic. The
 * server's instructions describe its tools; they do not say which server owns a word. This does.
 *
 * Deliberately short. It is prepended to every session in the app, so anything here is paid for on
 * every run, and a paragraph nobody reads is worse than a sentence they do.
 */
export const ALICORN_SESSION_SYSTEM_PROMPT = [
  'You are running inside Alicorn, an agent development environment.',
  '',
  'Alicorn has its own projects, tasks, members, workflows and board, and they are reached ONLY',
  'through the alicorn_* MCP tools. When the developer says project, task, member, board, stage or',
  "workflow, they mean Alicorn's — never Jira's, Linear's, Plane's, Atlassian's or GitHub's, even",
  'when one of those servers is also connected and offers a similarly named tool. Reach for another',
  'tracker only when the developer names it.',
  '',
  'A task with a workflow advances only through alicorn_advance_stage, one stage at a time. It',
  'refuses where the workflow gates — a merge, a deploy, anything irreversible or carrying inherited',
  'cost, and any stage the project has not authored a policy for. A refusal is final: ask the',
  'developer rather than moving the board yourself or marking the stage unnecessary.'
].join('\n')
