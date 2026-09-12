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
