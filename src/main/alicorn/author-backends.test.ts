import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { getAuthorBackendsForTask } from './author-backends'

describe('getAuthorBackendsForTask', () => {
  let db: OrchestrationDb

  function insertTask(id: string, deps: string[]): void {
    db.db
      .prepare('INSERT INTO tasks (id, run_id, spec, deps) VALUES (?, ?, ?, ?)')
      .run(id, 'run_1', id, JSON.stringify(deps))
  }

  function insertDispatch(id: string, taskId: string, status: string): void {
    db.db
      .prepare('INSERT INTO dispatch_contexts (id, run_id, task_id, status) VALUES (?, ?, ?, ?)')
      .run(id, 'run_1', taskId, status)
  }

  function insertWorkerDispatch(dispatchId: string, startOptions: string | null): void {
    db.db
      .prepare('INSERT INTO worker_dispatches (dispatch_id, start_options) VALUES (?, ?)')
      .run(dispatchId, startOptions)
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('is empty for a task with no dependencies', () => {
    insertTask('t1', [])
    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set())
  })

  it('is empty for a task that does not exist', () => {
    expect(getAuthorBackendsForTask(db, 'missing')).toEqual(new Set())
  })

  it('collects the member backend and the start-options backend', () => {
    insertTask('dep-member', [])
    insertTask('dep-direct', [])
    insertTask('t1', ['dep-member', 'dep-direct'])
    insertDispatch('d1', 'dep-member', 'completed')
    insertDispatch('d2', 'dep-direct', 'completed')
    db.setDispatchMember({
      dispatchId: 'd1',
      memberId: 'm1',
      memberRole: 'developer',
      backend: 'claude',
      reviewBackendBypass: false
    })
    insertWorkerDispatch('d2', '{"agent":"codex"}')

    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set(['claude', 'codex']))
  })

  it('ignores dispatches that have not completed', () => {
    insertTask('dep', [])
    insertTask('t1', ['dep'])
    insertDispatch('d1', 'dep', 'dispatched')
    insertWorkerDispatch('d1', '{"agent":"codex"}')

    // Work still in flight has authored nothing a reviewer could be judging.
    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set())
  })

  it('ignores an agent it cannot classify', () => {
    insertTask('dep', [])
    insertTask('t1', ['dep'])
    insertDispatch('d1', 'dep', 'completed')
    insertWorkerDispatch('d1', '{"agent":"aider"}')

    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set())
  })

  it('prefers the member backend over the start options', () => {
    insertTask('dep', [])
    insertTask('t1', ['dep'])
    insertDispatch('d1', 'dep', 'completed')
    insertWorkerDispatch('d1', '{"agent":"codex"}')
    db.setDispatchMember({
      dispatchId: 'd1',
      memberId: 'm1',
      memberRole: 'developer',
      backend: 'claude',
      reviewBackendBypass: false
    })

    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set(['claude']))
  })

  it('survives unparseable deps rather than failing the launch', () => {
    db.db
      .prepare('INSERT INTO tasks (id, run_id, spec, deps) VALUES (?, ?, ?, ?)')
      .run('t1', 'run_1', 't1', 'not json')

    expect(getAuthorBackendsForTask(db, 't1')).toEqual(new Set())
  })
})
