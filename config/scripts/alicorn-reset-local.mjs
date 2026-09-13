#!/usr/bin/env node
/**
 * Puts this machine back to a first-run Alicorn, for testing the install everyone else gets.
 *
 * Clears what Alicorn authored — projects, tasks, workflows, autonomy policies, the org policy, and
 * the local records binding a task to a session. Leaves what it did not: the repositories the app
 * knows about are Orca's, adding one is part of onboarding anyway, and deleting somebody's
 * repository list to test a screen is not a trade worth making.
 *
 * Members are cleared too, because the eight defaults are seeded at startup — a fresh install is
 * supposed to have them, and re-seeding is the thing being tested.
 *
 * Usage: node config/scripts/alicorn-reset-local.mjs [--yes]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const CONTAINER = 'alicorn-local-postgres-1'
const DB = ['-U', 'alicorn', '-d', 'alicorn']

// Order matters only where there is no cascade; projects cascade to tasks and workflows.
const STATEMENTS = [
  'DELETE FROM control.autonomy_policies',
  'DELETE FROM control.tasks',
  'DELETE FROM control.workflows',
  'DELETE FROM control.project_repos',
  'DELETE FROM control.projects',
  'DELETE FROM control.members',
  'DELETE FROM control.org_policies'
]

function psql(sql) {
  return execFileSync('docker', ['exec', CONTAINER, 'psql', ...DB, '-t', '-c', sql], {
    encoding: 'utf8'
  }).trim()
}

function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes every Alicorn project, task, workflow, member and policy.')
    console.log('Repositories and your git worktrees are left alone.')
    console.log('\nRe-run with --yes to do it.')
    return
  }

  for (const statement of STATEMENTS) {
    psql(statement)
  }
  console.log('control plane cleared')

  // The client's own record of which session works which task. A stale row points a ticket at a
  // conversation that no longer has anything to do with it.
  const orchestration = path.join(
    homedir(),
    'Library',
    'Application Support',
    'orca-dev',
    'orchestration.db'
  )
  if (existsSync(orchestration)) {
    for (const table of ['alicorn_sessions', 'alicorn_task_worktrees', 'alicorn_task_strategy']) {
      try {
        execFileSync('sqlite3', [orchestration, `DELETE FROM ${table};`], { encoding: 'utf8' })
      } catch {
        // A table this build never created is not an error; the point is that it is empty.
      }
    }
    console.log('local task/session bindings cleared')
  }

  // The assistant remembers which model you picked. A first run has not picked one.
  const localStorage = path.join(
    homedir(),
    'Library',
    'Application Support',
    'orca-dev',
    'Local Storage'
  )
  if (existsSync(localStorage) && process.argv.includes('--forget-ui')) {
    rmSync(localStorage, { recursive: true, force: true })
    console.log('renderer local storage cleared')
  }

  console.log('\nRestart Alicorn. It will seed the default members and open on an empty library.')
}

main()
