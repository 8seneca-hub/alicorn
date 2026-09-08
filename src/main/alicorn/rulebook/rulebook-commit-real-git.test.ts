import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { commitMemberRuleToRepo, type RulebookCommitWorktree } from './rulebook-commit'

const tempPaths: string[] = []

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function createRepo(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'alicorn-rulebook-'))
  tempPaths.push(repoPath)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' })
  git('init', '--quiet')
  // Pinned so a developer's global config cannot decide whether this passes.
  git('config', 'user.name', 'Alicorn Test')
  git('config', 'user.email', 'alicorn@example.test')
  git('config', 'commit.gpgSign', 'false')
  git('config', 'core.hooksPath', '.git/no-hooks')
  writeFileSync(join(repoPath, 'README.md'), 'seed\n')
  git('add', 'README.md')
  git('commit', '--quiet', '-m', 'seed')
  return repoPath
}

function deps(
  repoPath: string,
  overrides: { worktree?: Partial<RulebookCommitWorktree>; repo?: Partial<Repo> } = {}
): { runtime: { showManagedWorktree: () => Promise<RulebookCommitWorktree> }; store: Store } {
  const repo = { id: 'r1', path: repoPath, ...overrides.repo } as Repo
  return {
    runtime: {
      showManagedWorktree: async () => ({
        id: 'w1',
        path: repoPath,
        repoId: 'r1',
        ...overrides.worktree
      })
    },
    store: { getRepos: () => [repo] } as unknown as Store
  }
}

const request = {
  worktreeId: 'w1',
  memberId: 'm1',
  memberName: 'Builder',
  proposalId: 'p1',
  rule: 'Always run the migration before changing the schema type.'
}

function head(repoPath: string): string {
  return execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repoPath,
    encoding: 'utf8'
  }).trim()
}

describe('committing an accepted rule', () => {
  it('writes the rule file and commits it on a clean tree', async () => {
    const repoPath = createRepo()

    const result = await commitMemberRuleToRepo(deps(repoPath), request)

    expect(result).toEqual({ status: 'committed', filePath: '.alicorn/rules/builder-m1.md' })
    const contents = readFileSync(join(repoPath, '.alicorn/rules/builder-m1.md'), 'utf8')
    expect(contents).toContain('# Member rules — Builder')
    expect(contents).toContain(`- ${request.rule}`)
    // The marker is what makes a rendered rule traceable to the proposal a human accepted.
    expect(contents).toContain('<!-- rule:p1 -->')
    expect(head(repoPath)).toBe(`rules(Builder): ${request.rule}`)
    // Nothing else was swept in: the commit left a clean tree behind it.
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' }).trim()
    ).toBe('')
  })

  it('truncates a long rule in the commit subject but keeps it whole in the file', async () => {
    const repoPath = createRepo()
    const longRule = `Never ${'x'.repeat(120)} again.`

    await commitMemberRuleToRepo(deps(repoPath), { ...request, rule: longRule })

    expect(head(repoPath)).toBe(`rules(Builder): ${longRule.slice(0, 59)}…`)
    expect(readFileSync(join(repoPath, '.alicorn/rules/builder-m1.md'), 'utf8')).toContain(longRule)
  })

  it('appends a second rule to the same member file rather than replacing it', async () => {
    const repoPath = createRepo()
    await commitMemberRuleToRepo(deps(repoPath), request)

    const second = await commitMemberRuleToRepo(deps(repoPath), {
      ...request,
      proposalId: 'p2',
      rule: 'Never widen a column without a backfill.'
    })

    expect(second.status).toBe('committed')
    const contents = readFileSync(join(repoPath, '.alicorn/rules/builder-m1.md'), 'utf8')
    expect(contents).toContain('<!-- rule:p1 -->')
    expect(contents).toContain('<!-- rule:p2 -->')
    expect(contents).toContain('Never widen a column without a backfill.')
  })

  it('does not duplicate a bullet when the same proposal is committed twice', async () => {
    const repoPath = createRepo()
    await commitMemberRuleToRepo(deps(repoPath), request)

    const retry = await commitMemberRuleToRepo(deps(repoPath), request)

    expect(retry).toEqual({ status: 'committed', filePath: '.alicorn/rules/builder-m1.md' })
    const contents = readFileSync(join(repoPath, '.alicorn/rules/builder-m1.md'), 'utf8')
    expect(contents.match(/<!-- rule:p1 -->/g)).toHaveLength(1)
  })

  it('refuses a dirty worktree rather than committing the user’s work in progress', async () => {
    const repoPath = createRepo()
    writeFileSync(join(repoPath, 'README.md'), 'edited by the user\n')

    const result = await commitMemberRuleToRepo(deps(repoPath), request)

    expect(result).toEqual({ status: 'skipped', reason: 'dirty_worktree' })
  })

  it('skips a folder workspace, which has no repository to commit to', async () => {
    const repoPath = createRepo()

    const result = await commitMemberRuleToRepo(
      deps(repoPath, { repo: { kind: 'folder' } }),
      request
    )

    expect(result).toEqual({ status: 'skipped', reason: 'not_a_git_repository' })
  })

  it('skips an SSH-hosted workspace instead of writing to a path on this machine', async () => {
    const repoPath = createRepo()

    const result = await commitMemberRuleToRepo(
      deps(repoPath, { worktree: { hostId: 'ssh:build-box' } }),
      request
    )

    expect(result).toEqual({ status: 'skipped', reason: 'remote_workspace' })
  })

  it('skips when no workspace is open, because there is no repository to name', async () => {
    const repoPath = createRepo()

    const result = await commitMemberRuleToRepo(deps(repoPath), { ...request, worktreeId: null })

    expect(result).toEqual({ status: 'skipped', reason: 'no_origin_workspace' })
  })

  it('commits into the project root, not the dispatch worktree that earned the amendment', async () => {
    const repoPath = createRepo()
    const otherWorktree = mkdtempSync(join(tmpdir(), 'alicorn-rulebook-branch-'))
    tempPaths.push(otherWorktree)

    const result = await commitMemberRuleToRepo(
      deps(repoPath, { worktree: { path: otherWorktree } }),
      request
    )

    expect(result.status).toBe('committed')
    expect(readFileSync(join(repoPath, '.alicorn/rules/builder-m1.md'), 'utf8')).toContain(
      '<!-- rule:p1 -->'
    )
  })
})
