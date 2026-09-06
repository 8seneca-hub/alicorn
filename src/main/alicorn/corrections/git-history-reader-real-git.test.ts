import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { createGitHistoryReader } from './git-history-reader'

describe('git history reader real Git contract', () => {
  const tempPaths: string[] = []

  afterEach(() => {
    for (const path of tempPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('parses commit fields and paths, and lets --since exclude older commits', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'alicorn-corrections-'))
    tempPaths.push(repoPath)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' })
    const commitAt = (message: string, isoDate: string): string => {
      execFileSync('git', ['commit', '--quiet', '-m', message], {
        cwd: repoPath,
        env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
      })
      return git('rev-parse', 'HEAD').trim()
    }

    git('init', '--quiet')
    git('config', 'user.name', 'Alicorn Test')
    git('config', 'user.email', 'alicorn@example.test')
    git('config', 'commit.gpgSign', 'false')
    git('config', 'core.hooksPath', '.git/no-hooks')

    // Before --since: must not appear in commitsSince's result.
    writeFileSync(join(repoPath, 'old.txt'), 'old\n')
    git('add', 'old.txt')
    commitAt('old commit', '2020-01-01T00:00:00+00:00')

    writeFileSync(join(repoPath, 'a.txt'), 'a\n')
    git('add', 'a.txt')
    const firstSha = commitAt('add feature', '2024-06-01T10:00:00+00:00')

    writeFileSync(join(repoPath, 'a.txt'), 'a\nmore\n')
    writeFileSync(join(repoPath, 'b.txt'), 'b\n')
    git('add', 'a.txt', 'b.txt')
    execFileSync(
      'git',
      ['commit', '--quiet', '-m', 'fix bug', '-m', 'Detailed explanation.\nSecond line.'],
      {
        cwd: repoPath,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2024-06-02T12:30:00+00:00',
          GIT_COMMITTER_DATE: '2024-06-02T12:30:00+00:00'
        }
      }
    )
    const secondSha = git('rev-parse', 'HEAD').trim()

    const reader = createGitHistoryReader((argv) => gitExecFileAsync(argv, { cwd: repoPath }))
    const commits = await reader.commitsSince('2024-05-01T00:00:00+00:00')

    expect(commits).toHaveLength(2)
    // git log lists newest first.
    const [second, first] = commits
    expect(second).toEqual({
      sha: secondSha,
      authorTime: Date.parse('2024-06-02T12:30:00+00:00'),
      subject: 'fix bug',
      body: 'Detailed explanation.\nSecond line.',
      paths: ['a.txt', 'b.txt']
    })
    expect(first).toEqual({
      sha: firstSha,
      authorTime: Date.parse('2024-06-01T10:00:00+00:00'),
      subject: 'add feature',
      body: '',
      paths: ['a.txt']
    })
  })
})
