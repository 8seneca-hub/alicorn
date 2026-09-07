import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { resolveE2eWorktreeId } from './helpers/worktree-registration'
import { renderJournal } from '../../src/main/alicorn/foreman/journal-markdown'

// Rendered by the product's own writer rather than hand-written markdown: a fixture that spells a
// section heading differently from the parser tests the fixture, not the panel.
const JOURNAL = renderJournal({
  runId: 'run_alc42',
  objective: 'Ship partial refunds end to end, behind a flag.',
  status: 'running',
  startedAt: '2026-09-07T00:00:00.000Z',
  budgetCents: 5_000,
  spentCents: 1_234,
  decisions: [
    {
      n: 1,
      decision: 'Multi-currency at launch',
      chosen: 'yes',
      why: 'asked the user, they confirmed',
      reversible: false
    }
  ],
  assumptions: [
    {
      n: 1,
      assumption: 'Idempotency keys scoped per merchant',
      blastRadius: 'contained',
      dependents: ['3', '4']
    }
  ],
  // The template's own four-node example: orient, two builders against a contract, then review.
  plan: [
    {
      id: '1',
      title: 'orient — map the area',
      owner: 'scout',
      dependsOn: [],
      status: 'done',
      model: 'haiku',
      dispatchId: 'ctx_1'
    },
    {
      id: '2',
      title: 'backend endpoint',
      owner: 'builder',
      dependsOn: ['1'],
      status: 'dispatched',
      model: 'opus',
      dispatchId: 'ctx_2'
    },
    {
      id: '3',
      title: 'frontend, against contract',
      owner: 'builder',
      dependsOn: ['1'],
      status: 'dispatched',
      model: 'opus',
      dispatchId: 'ctx_3'
    },
    {
      id: '4',
      title: 'review',
      owner: 'reviewer — not the author',
      dependsOn: ['2', '3'],
      status: 'pending',
      model: 'codex/sonnet',
      dispatchId: null
    }
  ],
  contractRegistry: 'POST /refunds/partial',
  log: [{ at: '2026-09-07T00:01:00.000Z', line: 'dispatched node 2' }],
  notDone: ['nothing yet']
})

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

      const worktreeId = await resolveE2eWorktreeId(orcaPage, testRepoPath, worktreePath)
      await orcaPage.evaluate(
        ({ worktreeId }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is not available')
          }
          store.getState().setActiveWorktree(worktreeId)
          store.getState().setRightSidebarTab('run')
          store.getState().setRightSidebarOpen(true)
        },
        { worktreeId }
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
      // The ids `after 2, 3` refers to must be on screen too, or the dependency is unreadable.
      // Scoped to the plan list: a bare `getByText('2')` matches the status bar and the terminal.
      await expect(orcaPage.getByText('after 2, 3')).toBeVisible()
      const plan = orcaPage.getByTestId('run-view-plan')
      for (const id of ['1', '2', '3', '4']) {
        await expect(plan.getByText(id, { exact: true })).toBeVisible()
      }

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
