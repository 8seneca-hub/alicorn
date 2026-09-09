export function pickRemoteCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of [
    'ALICORN_TERMINAL_HANDLE',
    'ALICORN_WORKTREE_ID',
    'ALICORN_PANE_KEY',
    'ALICORN_AGENT_LAUNCH_TOKEN',
    'ALICORN_WORKSPACE_ID',
    'ALICORN_USER_DATA_PATH',
    'PATH',
    'Path'
  ]) {
    const value = env[key]
    if (typeof value === 'string') {
      picked[key] = value
    }
  }
  return picked
}
