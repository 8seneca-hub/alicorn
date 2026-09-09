import { describe, expect, it, vi } from 'vitest'
import {
  INTEGRATION_VERIFY_TIMEOUT_MS,
  integrationVerifyEnv,
  runIntegrationVerifyCheck,
  worktreePathEnvName,
  type IntegrationVerifyWorkspace
} from './integration-verify-check'
import type { IntegrationVerifyCheck } from '../../../shared/alicorn/members'

const CHECK: IntegrationVerifyCheck = {
  kind: 'integration_verify',
  command: 'pnpm run test:integration',
  repoId: 'repo-api'
}

const API: IntegrationVerifyWorkspace = {
  repoId: 'repo-api',
  worktreeId: 'wt-api',
  path: '/work/api',
  executionHostId: 'local'
}
const WEB: IntegrationVerifyWorkspace = {
  repoId: 'repo-web',
  worktreeId: 'wt-web',
  path: '/work/web',
  executionHostId: 'local'
}

function processResult(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides
  }
}

describe('worktreePathEnvName', () => {
  it('slugs a repo id into an ALICORN_ name', () => {
    expect(worktreePathEnvName('repo-api')).toBe('ALICORN_WORKTREE_REPO_API')
    expect(worktreePathEnvName('folder-workspace:pg_1')).toBe(
      'ALICORN_WORKTREE_FOLDER_WORKSPACE_PG_1'
    )
    expect(worktreePathEnvName('---')).toBe('ALICORN_WORKTREE_UNNAMED')
  })
})

describe('integrationVerifyEnv', () => {
  it('exports every workspace that shares the target host', () => {
    expect(integrationVerifyEnv([API, WEB], 'local')).toEqual({
      env: { ALICORN_WORKTREE_REPO_API: '/work/api', ALICORN_WORKTREE_REPO_WEB: '/work/web' },
      offHostRepoIds: []
    })
  })

  it('names an off-host workspace instead of exporting a path that means nothing here', () => {
    const remote = { ...WEB, executionHostId: 'ssh:box' as const }
    expect(integrationVerifyEnv([API, remote], 'local')).toEqual({
      env: { ALICORN_WORKTREE_REPO_API: '/work/api' },
      offHostRepoIds: ['repo-web']
    })
  })

  it('treats an unresolved host as off-host, never as local', () => {
    const unresolved = { ...WEB, executionHostId: null }
    expect(integrationVerifyEnv([API, unresolved], 'local')).toEqual({
      env: { ALICORN_WORKTREE_REPO_API: '/work/api' },
      offHostRepoIds: ['repo-web']
    })
  })
})

describe('runIntegrationVerifyCheck (local)', () => {
  it('passes on exit 0 and carries the other tuples paths in the env', async () => {
    const runProcess = vi.fn(async (spec: unknown) => {
      void spec
      return processResult()
    })
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [API, WEB],
      runProcess: runProcess as never
    })

    expect(result.status).toBe('passed')
    const spec = runProcess.mock.calls[0]![0] as {
      cwd: string
      env: Record<string, string>
      args: string[]
      timeoutMs: number
    }
    expect(spec.cwd).toBe('/work/api')
    expect(spec.env.ALICORN_WORKTREE_REPO_WEB).toBe('/work/web')
    expect(spec.env.ALICORN_WORKTREE_REPO_API).toBe('/work/api')
    // Merged, not replaced: the command still needs the rest of its environment.
    expect(spec.env.PATH).toBe(process.env.PATH)
    expect(spec.args.at(-1)).toBe('pnpm run test:integration')
    expect(spec.timeoutMs).toBe(INTEGRATION_VERIFY_TIMEOUT_MS)
  })

  it('fails on a non-zero exit and keeps the stderr tail', async () => {
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [API, WEB],
      runProcess: (async () => processResult({ code: 1, stderr: 'boom' })) as never
    })
    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({ exitCode: 1, stderrTail: 'boom' })
  })

  it('reports a timeout as unknown, never as a pass and never as a fail', async () => {
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [API],
      timeoutMs: 1000,
      runProcess: (async () => processResult({ code: null, timedOut: true })) as never
    })
    expect(result.status).toBe('skipped')
    expect(result.detail).toMatchObject({ reason: 'timed_out', timeoutMs: 1000 })
  })

  it('errors when the shell could not be spawned at all', async () => {
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [API],
      runProcess: (async () => {
        throw new Error('ENOENT')
      }) as never
    })
    expect(result.status).toBe('error')
    expect(result.detail).toMatchObject({ reason: 'spawn_failed' })
  })

  it('runs a folder workspace, which is not a git worktree', async () => {
    const folder: IntegrationVerifyWorkspace = {
      repoId: 'folder-workspace:pg-1',
      worktreeId: 'folder:ws-1',
      path: '/work/docs',
      executionHostId: 'local'
    }
    const result = await runIntegrationVerifyCheck({
      check: { ...CHECK, repoId: folder.repoId },
      workspaces: [folder],
      runProcess: (async () => processResult()) as never
    })
    expect(result.status).toBe('passed')
  })

  it('is unknown when the check names a repo the task never bound', async () => {
    const runProcess = vi.fn(async () => processResult())
    const result = await runIntegrationVerifyCheck({
      check: { ...CHECK, repoId: 'repo-absent' },
      workspaces: [API],
      runProcess: runProcess as never
    })
    expect(result).toEqual({
      status: 'skipped',
      detail: { reason: 'repo_not_bound', repoId: 'repo-absent' }
    })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('never runs locally on a workspace whose host it could not resolve', async () => {
    const runProcess = vi.fn(async () => processResult())
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [{ ...API, executionHostId: null }],
      runProcess: runProcess as never
    })
    expect(result.status).toBe('skipped')
    expect(result.detail).toMatchObject({ reason: 'execution_host_unresolved' })
    expect(runProcess).not.toHaveBeenCalled()
  })
})

describe('runIntegrationVerifyCheck (ssh)', () => {
  const REMOTE: IntegrationVerifyWorkspace = {
    ...API,
    executionHostId: 'ssh:box',
    path: '/srv/api'
  }

  it('runs through the host provider, never on this machine', async () => {
    const runProcess = vi.fn(async () => processResult())
    const hostExec = vi.fn(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false
    }))
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [REMOTE, { ...WEB, executionHostId: 'ssh:box', path: '/srv/web' }],
      hostExec,
      runProcess: runProcess as never
    })

    expect(result.status).toBe('passed')
    expect(runProcess).not.toHaveBeenCalled()
    expect(hostExec).toHaveBeenCalledWith(
      expect.objectContaining({
        executionHostId: 'ssh:box',
        cwd: '/srv/api',
        env: {
          ALICORN_WORKTREE_REPO_API: '/srv/api',
          ALICORN_WORKTREE_REPO_WEB: '/srv/web'
        }
      })
    )
  })

  it('reports an unreachable host as unknown — loss of contact is not evidence', async () => {
    const withoutProvider = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [REMOTE],
      runProcess: (async () => processResult()) as never
    })
    expect(withoutProvider.status).toBe('skipped')
    expect(withoutProvider.detail).toMatchObject({ reason: 'execution_host_unreachable' })

    const throwing = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [REMOTE],
      hostExec: async () => {
        throw new Error('ssh provider unavailable for box')
      }
    })
    expect(throwing.status).toBe('skipped')
    expect(throwing.detail).toMatchObject({ reason: 'execution_host_unreachable' })
  })

  it('reports a remote timeout as unknown', async () => {
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [REMOTE],
      hostExec: async () => ({ stdout: '', stderr: '', exitCode: null, timedOut: true })
    })
    expect(result.status).toBe('skipped')
    expect(result.detail).toMatchObject({ reason: 'timed_out' })
  })

  it('fails on a remote non-zero exit', async () => {
    const result = await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [REMOTE],
      hostExec: async () => ({ stdout: '', stderr: 'contract drift', exitCode: 2, timedOut: false })
    })
    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({ exitCode: 2, stderrTail: 'contract drift' })
  })

  it('uses cmd.exe when the remote worktree path is a Windows one', async () => {
    const hostExec = vi.fn(async (input: { args: string[] }) => {
      void input
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false }
    })
    await runIntegrationVerifyCheck({
      check: CHECK,
      workspaces: [{ ...REMOTE, path: 'C:\\work\\api' }],
      hostExec
    })
    expect(hostExec.mock.calls[0]![0]).toMatchObject({ args: ['/d', '/s', '/c', CHECK.command] })
  })
})
