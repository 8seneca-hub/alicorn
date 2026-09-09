import { describe, expect, it } from 'vitest'
import { pickRemoteCliEnv } from './remote-cli-env'

describe('pickRemoteCliEnv', () => {
  it('forwards SSH Orca terminal and worktree context for remote CLI calls', () => {
    expect(
      pickRemoteCliEnv({
        ALICORN_TERMINAL_HANDLE: 'term_ssh',
        ALICORN_WORKTREE_ID: 'repo::remote',
        ALICORN_PANE_KEY: 'pane-1',
        ALICORN_AGENT_LAUNCH_TOKEN: 'launch-secret',
        ALICORN_WORKSPACE_ID: 'workspace-1',
        ALICORN_USER_DATA_PATH: '/tmp/orca',
        PATH: '/usr/bin',
        SECRET_TOKEN: 'nope'
      })
    ).toEqual({
      ALICORN_TERMINAL_HANDLE: 'term_ssh',
      ALICORN_WORKTREE_ID: 'repo::remote',
      ALICORN_PANE_KEY: 'pane-1',
      ALICORN_AGENT_LAUNCH_TOKEN: 'launch-secret',
      ALICORN_WORKSPACE_ID: 'workspace-1',
      ALICORN_USER_DATA_PATH: '/tmp/orca',
      PATH: '/usr/bin'
    })
  })
})
