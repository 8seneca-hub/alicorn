import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { loadWorktreesUntilPathsPresent } from './helpers/worktree-registration'

// The four-node example from docs/alicorn/foreman-templates.md §3, written as a lead would.
const JOURNAL = `# run_alc42 — partial refunds

**Status:** running
**Started:** 2026-09-07T00:00:00.000Z   **Budget:** $50.00
**Spent so far:** $12.34

## Objective
Ship partial refunds end to end, behind a flag.

## Decisions
| # | Decision | Chosen | Why | Reversible? |
|---|---|---|---|---|
| 1 | Multi-currency at launch | yes | asked user, they confirmed | no — changes schema |

## Assumptions made without asking
| # | Assumption | Blast radius | Nodes depending on it |
|---|---|---|---|
| 1 | Idempotency keys scoped per merchant | contained | 3, 4 |

## Plan
| Node | Title | Owner | Depends on | Status | Model | Dispatch |
|---|---|---|---|---|---|---|
| 1 | orient — map the area | scout | — | done | haiku | ctx_1 |
| 2 | backend endpoint | builder | 1 | dispatched | opus | ctx_2 |
| 3 | frontend, against contract | builder | 1 | dispatched | opus | ctx_3 |
| 4 | review | reviewer — not the author | 2, 3 | pending | codex/sonnet | — |

## Contract registry
POST /refunds/partial

## Log
| At | Line |
|---|---|
| 2026-09-07T00:01:00.000Z | dispatched node 2 |

## Not done
- nothing yet
`

test.describe('Foreman run view', () => {
  test('draws the plan and the cost meter for a run on disk', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    const branchName = `e2e-run-view-${Date.now()}`
    const worktreePath = path.join(os.tmpdir(), branchName)
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
      cwd: testRepoPath,
      stdio: 'pipe'
    })
    try {
      mkdirSync(path.join(worktreePath, '.foreman', 'run_alc42'), { recursive: true })
      writeFileSync(path.join(worktreePath, '.foreman', 'run_alc42', 'journal.md'), JOURNAL)

      await loadWorktreesUntilPathsPresent(orcaPage, testRepoPath, [worktreePath])
      await orcaPage.evaluate(
        ({ targetPath }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is not available')
          }
          const worktree = Object.values(store.getState().worktreesByRepo)
            .flat()
            .find((entry) => entry.path === targetPath)
          if (!worktree) {
            throw new Error(`E2E worktree missing from the store: ${targetPath}`)
          }
          store.getState().setActiveWorktree(worktree.id)
          store.getState().setRightSidebarTab('run')
          store.getState().setRightSidebarOpen(true)
        },
        { targetPath: worktreePath }
      )

      // Every node title, so a row that fails to render is a failure here rather than a screenshot
      // nobody reads.
      await expect(orcaPage.getByText('orient — map the area')).toBeVisible()
      await expect(orcaPage.getByText('backend endpoint')).toBeVisible()
      await expect(orcaPage.getByText('frontend, against contract')).toBeVisible()
      await expect(orcaPage.getByText('reviewer — not the author')).toBeVisible()
      await expect(
        orcaPage.getByText('Ship partial refunds end to end, behind a flag.')
      ).toBeVisible()
      await expect(orcaPage.getByText('run_alc42')).toBeVisible()
      // Nothing has been priced in a fresh profile, so the meter must say so rather than show $0.
      await expect(orcaPage.getByTestId('run-view-cost')).toHaveText('—')

      testInfo.attach('run-view', {
        body: await orcaPage.screenshot(),
        contentType: 'image/png'
      })
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: testRepoPath,
          stdio: 'pipe'
        })
      } catch {
        rmSync(worktreePath, { recursive: true, force: true })
      }
      try {
        execFileSync('git', ['branch', '-D', branchName], { cwd: testRepoPath, stdio: 'pipe' })
      } catch {
        // The branch may already be gone with the worktree.
      }
    }
  })
})
