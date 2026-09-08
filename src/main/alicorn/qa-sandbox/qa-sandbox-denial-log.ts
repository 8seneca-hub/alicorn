/**
 * A denial the agent can see but nobody can count is a prompt line with extra steps, so every
 * refusal also lands in the main-process log on one stable, greppable line.
 *
 * The workspace path is the attribution key: the hook payload carries no dispatch id — the pane is
 * launched before the dispatch row exists — so the worktree is what ties a denial back to a run
 * until that id is plumbed through the launch env. Ledger attribution is the follow-up, not this.
 */
export type QaSandboxDenial = {
  toolName: string
  workspacePath: string
  reason: string
}

export const QA_SANDBOX_DENIAL_LOG_PREFIX = '[alicorn] qa-sandbox denied'

export function recordQaSandboxDenial(
  denial: QaSandboxDenial,
  log: (message: string) => void = console.warn
): void {
  log(
    `${QA_SANDBOX_DENIAL_LOG_PREFIX} ${JSON.stringify({
      tool: denial.toolName,
      workspace: denial.workspacePath,
      reason: denial.reason
    })}`
  )
}
