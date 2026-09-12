/**
 * The chat session a task is worked in.
 *
 * Client-side state, like the feature-workspace tuples beside it: a session id names a provider
 * child on this machine and means nothing on another, so it is never sent to the control plane.
 * The worktree travels with it because a session id alone cannot be resolved back to the workspace
 * it is running in.
 */
export type TaskSessionBinding = {
  sessionId: string
  agent: string
  worktreeId: string
}

/** A project's chat is a subject too — spelled so it can never collide with a task id. */
export function projectChatSubjectId(projectId: string): string {
  return `project:${projectId}`
}

/**
 * The org chat: one session for the whole library, not one per project.
 *
 * It is the surface you talk to about anything — create a member, add a skill, open a ticket in
 * whichever project — so scoping it to a project would be the wrong shape. A constant, because
 * there is exactly one.
 */
export const ORG_CHAT_SUBJECT_ID = 'org:chat'

export function isTaskSessionBinding(value: unknown): value is TaskSessionBinding {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<TaskSessionBinding>
  return (
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.length > 0 &&
    typeof candidate.agent === 'string' &&
    candidate.agent.length > 0 &&
    typeof candidate.worktreeId === 'string' &&
    candidate.worktreeId.length > 0
  )
}
