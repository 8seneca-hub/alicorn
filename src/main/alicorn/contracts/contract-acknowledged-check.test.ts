import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveContractAcknowledged,
  runContractAcknowledgedCheck
} from './contract-acknowledged-check'
import type { ContractEntry } from '../foreman/contract-registry'
import { journalPath, writeJournal } from '../foreman/journal'
import { emptyContractRegistry } from '../foreman/contract-registry'
import type { Journal } from '../foreman/journal'

function entry(over: Partial<ContractEntry> = {}): ContractEntry {
  return {
    repo: 'api',
    kind: 'endpoint',
    name: 'GET /refunds/{id}',
    shape: 'path id: string → 200 {id: string}',
    provenance: 'extracted',
    source: 'openapi.json#/paths/~1refunds~1{id}/get',
    breaking: true,
    ...over
  }
}

describe('resolveContractAcknowledged', () => {
  it('passes when nothing is breaking', () => {
    expect(resolveContractAcknowledged([entry({ breaking: false })], [])).toEqual({
      status: 'passed',
      detail: { breaking: 0 }
    })
  })

  it('fails and names the unacknowledged breaks', () => {
    const result = resolveContractAcknowledged([entry(), entry({ name: 'Refund' })], [])
    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({ breaking: 2, unacknowledged: 2 })
    expect(result.detail.contracts).toEqual([
      { repo: 'api', name: 'GET /refunds/{id}', source: 'openapi.json#/paths/~1refunds~1{id}/get' },
      { repo: 'api', name: 'Refund', source: 'openapi.json#/paths/~1refunds~1{id}/get' }
    ])
  })

  it('passes once every breaking contract is acknowledged, case- and space-insensitively', () => {
    const result = resolveContractAcknowledged([entry({ name: 'Refund' })], ['  refund '])
    expect(result).toEqual({ status: 'passed', detail: { breaking: 1, unacknowledged: 0 } })
  })

  it('still fails when only some are acknowledged', () => {
    const result = resolveContractAcknowledged([entry(), entry({ name: 'Refund' })], ['Refund'])
    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({ breaking: 2, unacknowledged: 1 })
  })
})

describe('runContractAcknowledgedCheck', () => {
  async function worktreeWith(entries: ContractEntry[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'alicorn-cr2-'))
    const journal: Journal = {
      runId: 'run_1',
      objective: 'ship it',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      budgetCents: null,
      spentCents: null,
      decisions: [],
      assumptions: [],
      plan: [],
      waves: [],
      contractRegistry: { ...emptyContractRegistry(), entries },
      log: [],
      notDone: []
    }
    await writeJournal(journalPath(root, 'run_1'), journal)
    return root
  }

  const never = async (): Promise<string[]> => {
    throw new Error('should not be called')
  }

  it('passes with no journal — a single run keeps no registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alicorn-cr2-'))
    const result = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: never
    })
    expect(result).toEqual({ status: 'passed', detail: { reason: 'no_contract_registry' } })
  })

  it('does not ask the control plane when nothing is breaking', async () => {
    const root = await worktreeWith([entry({ breaking: false })])
    const result = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: never
    })
    expect(result).toEqual({ status: 'passed', detail: { breaking: 0 } })
  })

  it('fails on an unacknowledged break and passes once acknowledged', async () => {
    const root = await worktreeWith([entry()])
    const failed = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: async () => []
    })
    expect(failed.status).toBe('failed')

    const passed = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: async () => ['GET /refunds/{id}']
    })
    expect(passed.status).toBe('passed')
  })

  it('errors rather than passes when the acknowledgements cannot be read', async () => {
    const root = await worktreeWith([entry()])
    const result = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: async () => {
        throw new Error('control plane down')
      }
    })
    expect(result.status).toBe('error')
    expect(result.detail).toMatchObject({ reason: 'acknowledgements_unreadable' })
  })

  it('errors rather than passes when the journal will not parse', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alicorn-cr2-'))
    await mkdir(join(root, '.foreman', 'run_1'), { recursive: true })
    await writeFile(journalPath(root, 'run_1'), 'not a journal', 'utf8')
    const result = await runContractAcknowledgedCheck({
      worktreePath: root,
      runId: 'run_1',
      projectId: 'proj',
      listAcknowledgedNames: never
    })
    expect(result.status).toBe('error')
    expect(result.detail).toMatchObject({ reason: 'journal_unreadable' })
  })
})
