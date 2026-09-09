import { describe, expect, it } from 'vitest'
import {
  AcknowledgeContractsBodySchema,
  CONTRACT_ACK_BATCH_MAX,
  RequiredCheckSchema,
  RequiredChecksSchema
} from './index.js'

describe('contract_acknowledged required check', () => {
  it('parses with no parameters — the registry decides what is breaking', () => {
    expect(RequiredCheckSchema.parse({ kind: 'contract_acknowledged' })).toEqual({
      kind: 'contract_acknowledged'
    })
  })

  it('still parses diff_coverage alongside it', () => {
    const checks = RequiredChecksSchema.parse([
      { kind: 'diff_coverage', threshold: 0.8 },
      { kind: 'contract_acknowledged' }
    ])
    expect(checks.map((check) => check.kind)).toEqual(['diff_coverage', 'contract_acknowledged'])
  })

  it('rejects an unknown kind rather than widening the union by accident', () => {
    expect(RequiredCheckSchema.safeParse({ kind: 'vibes' }).success).toBe(false)
  })
})

describe('AcknowledgeContractsBodySchema', () => {
  it('requires a run and at least one name', () => {
    expect(
      AcknowledgeContractsBodySchema.parse({ runId: 'run_1', contractNames: ['Refund'] })
    ).toEqual({ runId: 'run_1', contractNames: ['Refund'] })
    expect(AcknowledgeContractsBodySchema.safeParse({ runId: 'run_1', contractNames: [] }).success).toBe(false)
    expect(AcknowledgeContractsBodySchema.safeParse({ contractNames: ['Refund'] }).success).toBe(false)
  })

  it('caps the batch so one request cannot acknowledge an unbounded set', () => {
    const names = Array.from({ length: CONTRACT_ACK_BATCH_MAX + 1 }, (_, i) => `c${i}`)
    expect(AcknowledgeContractsBodySchema.safeParse({ runId: 'run_1', contractNames: names }).success).toBe(false)
  })
})
