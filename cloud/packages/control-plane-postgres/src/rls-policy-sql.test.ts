import { describe, expect, it } from 'vitest'
import { tenantRlsPolicySql } from './rls-policy-sql.js'

describe('tenantRlsPolicySql', () => {
  it('forces RLS and creates an idempotent tenant policy', () => {
    const sql = tenantRlsPolicySql('members')
    expect(sql).toContain('ALTER TABLE members ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE members FORCE ROW LEVEL SECURITY')
    expect(sql).toContain("policyname = 'members_tenant_isolation'")
    expect(sql).toContain("current_setting('app.tenant_id', true)")
  })
  it('rejects identifiers that are not plain snake_case', () => {
    expect(() => tenantRlsPolicySql('members; DROP TABLE users')).toThrow()
  })
})
