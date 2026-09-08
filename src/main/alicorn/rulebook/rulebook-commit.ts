import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { isFolderRepo } from '../../../shared/repo-kind'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import {
  runtimeGitRouteForTarget,
  type RuntimeGitTarget
} from '../../runtime/runtime-git-command-target'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree, type GitRuntimeOptions } from '../../git/git-runtime-options'
import { literalPathspec } from '../../git/source-control/git-pathspec'
import { runWithGitReadCacheInvalidation } from '../../git/source-control/git-read-cache-invalidation'
import { gitOptionalLocksDisabledEnv } from '../../git/command-runner/git-process-env'
import { getLocalProjectWorktreeGitOptions } from '../../project-runtime-git-options'
import {
  memberRuleFileSlug,
  type RulebookCommitResult
} from '../../../shared/alicorn/rule-proposals'

/**
 * Where a member's standing rules live in the repo. Forward slashes, not `path.join`: this is a
 * repository path that ends up in a Git pathspec, and a backslash is wrong on every host.
 */
export const RULES_DIR = '.alicorn/rules'

const COMMIT_SUBJECT_RULE_CHARS = 60

/** An unset `user.email` is the likeliest real cause of a refused commit; say so rather than "failed". */
const GIT_IDENTITY_RE = /Please tell me who you are|user\.name|user\.email/i

export type RulebookCommitWorktree = {
  id: string
  path: string
  repoId: string
  hostId?: ExecutionHostId
}

export type RulebookCommitDeps = {
  runtime: { showManagedWorktree: (selector: string) => Promise<RulebookCommitWorktree> }
  store: Store | null
}

export type RulebookCommitRequest = {
  worktreeId: string | null
  memberId: string
  memberName: string
  proposalId: string
  rule: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function ruleMarker(proposalId: string): string {
  return `<!-- rule:${proposalId} -->`
}

/** One bullet per accepted rule, each traceable to the proposal a human accepted it from. */
function renderRuleEntry(rule: string, proposalId: string): string {
  return `\n- ${rule.trim()}\n${ruleMarker(proposalId)}\n`
}

function renderFileHeader(memberName: string): string {
  return [
    `# Member rules — ${memberName}`,
    '',
    '<!-- Written by Alicorn when a human accepts a proposed rule. Append-only: the member in',
    '     Settings is the source of truth, and this file is how a rule shows up in a diff. -->',
    ''
  ].join('\n')
}

function commitSubject(memberName: string, rule: string): string {
  const collapsed = rule.replace(/\s+/g, ' ').trim()
  const summary =
    collapsed.length > COMMIT_SUBJECT_RULE_CHARS
      ? `${collapsed.slice(0, COMMIT_SUBJECT_RULE_CHARS - 1)}…`
      : collapsed
  return `rules(${memberName}): ${summary}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type CommitTarget = { path: string; gitOptions: GitRuntimeOptions }

/**
 * The repository root, not the dispatch worktree: a standing rule is a property of the project, so
 * committing it onto whichever feature branch happened to earn the amendment would strand it there.
 * Returns a skip reason for every workspace this cannot legitimately write to.
 */
async function resolveCommitTarget(
  deps: RulebookCommitDeps,
  worktreeId: string
): Promise<CommitTarget | RulebookCommitResult> {
  let worktree: RulebookCommitWorktree
  try {
    worktree = await deps.runtime.showManagedWorktree(`id:${worktreeId}`)
  } catch (error) {
    return { status: 'skipped', reason: 'no_origin_workspace', message: describe(error) }
  }

  try {
    // Routes on the execution host id, never on `connectionId` — that field spells "runtime host",
    // "unresolved" and "genuinely local" all as undefined (#11163).
    const route = runtimeGitRouteForTarget({
      executionHostId: worktree.hostId ?? LOCAL_EXECUTION_HOST_ID
    } as RuntimeGitTarget)
    if (route.kind === 'ssh') {
      // The write below goes through this host's filesystem, which cannot reach the remote path,
      // and the relay restricts generic git.exec. Refusing is the only correct answer.
      return { status: 'skipped', reason: 'remote_workspace' }
    }
  } catch (error) {
    return { status: 'skipped', reason: 'remote_workspace', message: describe(error) }
  }

  const repo: Repo | undefined = deps.store
    ?.getRepos()
    .find((candidate: Repo) => candidate.id === worktree.repoId)
  if (repo && isFolderRepo(repo)) {
    return { status: 'skipped', reason: 'not_a_git_repository' }
  }

  // `repo.path` is the primary worktree by definition; fall back to the dispatch worktree only
  // when the repo row is missing, which is better than not committing at all.
  const targetPath = repo?.path ?? worktree.path
  if (!(await pathExists(join(targetPath, '.git')))) {
    return { status: 'skipped', reason: 'not_a_git_repository' }
  }

  // Same connectionId guard as the corrections sweep: a repo routed to another host must not lend
  // this locally-routed worktree its WSL distro.
  const gitOptions: GitRuntimeOptions =
    repo && !repo.connectionId && deps.store
      ? // Why interactive: this is a direct response to a click, unlike the sweep's background scan.
        { ...getLocalProjectWorktreeGitOptions(deps.store, repo), admissionTier: 'interactive' }
      : { admissionTier: 'interactive' }
  return { path: targetPath, gitOptions }
}

/**
 * Writes an accepted rule into the repo as `.alicorn/rules/<member>.md` and commits it.
 *
 * Best-effort by design: the rule is already on the member server-side by the time this runs, so
 * every refusal is a `skipped` result the pane reports, never a thrown error that would make an
 * accepted rule look rejected. An SSH host and a folder workspace both skip — the first because
 * this writes through the local filesystem, the second because there is no repository to commit to.
 */
export async function commitMemberRuleToRepo(
  deps: RulebookCommitDeps,
  request: RulebookCommitRequest
): Promise<RulebookCommitResult> {
  if (!request.worktreeId) {
    return { status: 'skipped', reason: 'no_origin_workspace' }
  }
  const target = await resolveCommitTarget(deps, request.worktreeId)
  if ('status' in target) {
    return target
  }

  const relativePath = `${RULES_DIR}/${memberRuleFileSlug(request.memberName, request.memberId)}.md`
  const absolutePath = join(target.path, ...relativePath.split('/'))

  try {
    // Refuse on a dirty tree so the commit carries the rule file and nothing the user was midway
    // through. `status --porcelain` predates the 2.25 baseline. `--untracked-files=all` so a rules
    // file someone hand-wrote but never staged is not silently swept into our commit.
    const { stdout } = await gitExecFileAsync(['status', '--porcelain', '--untracked-files=all'], {
      ...gitOptionsForWorktree(target.path, target.gitOptions),
      // Don't take Git's optional index lock while the user may be running fetch/pull in a terminal.
      env: gitOptionalLocksDisabledEnv()
    })
    if (stdout.trim()) {
      return { status: 'skipped', reason: 'dirty_worktree' }
    }
  } catch (error) {
    return { status: 'skipped', reason: 'not_a_git_repository', message: describe(error) }
  }

  try {
    const existing = (await pathExists(absolutePath)) ? await readFile(absolutePath, 'utf8') : null
    if (existing?.includes(ruleMarker(request.proposalId))) {
      // A retry after a commit that already landed: the rule is in the repo, and re-appending it
      // would duplicate the bullet.
      return { status: 'committed', filePath: relativePath }
    }
    const next = existing
      ? `${existing.replace(/\s*$/, '\n')}${renderRuleEntry(request.rule, request.proposalId)}`
      : `${renderFileHeader(request.memberName)}${renderRuleEntry(request.rule, request.proposalId)}`
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, next, 'utf8')
  } catch (error) {
    return { status: 'skipped', reason: 'commit_failed', message: describe(error) }
  }

  try {
    // Bracketed so a post-commit `getStatus()` cannot join a pre-commit read and publish it as
    // current — the same discipline every mutation in git/source-control follows.
    await runWithGitReadCacheInvalidation(async () => {
      const options = gitOptionsForWorktree(target.path, target.gitOptions)
      // Stage only the rule file, then commit the index: anything that appeared between the status
      // check and now stays unstaged and out of this commit.
      await gitExecFileAsync(
        ['add', '--', literalPathspec(relativePath, target.gitOptions)],
        options
      )
      await gitExecFileAsync(
        ['commit', '-m', commitSubject(request.memberName, request.rule)],
        options
      )
    })
  } catch (error) {
    const message = describe(error)
    return {
      status: 'skipped',
      reason: 'commit_failed',
      message: GIT_IDENTITY_RE.test(message)
        ? `Git has no commit identity in this repository (user.name / user.email). ${message}`
        : message
    }
  }

  return { status: 'committed', filePath: relativePath }
}
