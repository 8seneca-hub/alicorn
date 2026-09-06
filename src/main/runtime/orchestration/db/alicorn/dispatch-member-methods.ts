import type { OrchestrationDb } from '../orchestration-db'
import type { DispatchMemberRow } from './alicorn-rows'

type AlicornDispatchMemberRow = {
  dispatch_id: string
  member_id: string
  member_role: string
  backend: string
  review_backend_bypass: number
  created_at: string
}

export function setDispatchMember(
  this: OrchestrationDb,
  row: {
    dispatchId: string
    memberId: string
    memberRole: string
    backend: string
    reviewBackendBypass: boolean
  }
): void {
  this.db
    .prepare(
      `INSERT INTO alicorn_dispatch_members
         (dispatch_id, member_id, member_role, backend, review_backend_bypass)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(dispatch_id) DO UPDATE SET
         member_id = excluded.member_id,
         member_role = excluded.member_role,
         backend = excluded.backend,
         review_backend_bypass = excluded.review_backend_bypass`
    )
    .run(row.dispatchId, row.memberId, row.memberRole, row.backend, row.reviewBackendBypass ? 1 : 0)
}

export function getDispatchMember(
  this: OrchestrationDb,
  dispatchId: string
): DispatchMemberRow | undefined {
  const row = this.db
    .prepare('SELECT * FROM alicorn_dispatch_members WHERE dispatch_id = ?')
    .get(dispatchId) as AlicornDispatchMemberRow | undefined
  if (!row) {
    return undefined
  }
  return {
    dispatchId: row.dispatch_id,
    memberId: row.member_id,
    memberRole: row.member_role,
    backend: row.backend,
    reviewBackendBypass: row.review_backend_bypass === 1
  }
}

export type DispatchMemberMethods = {
  setDispatchMember: typeof setDispatchMember
  getDispatchMember: typeof getDispatchMember
}

export function attachDispatchMemberMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setDispatchMember,
    getDispatchMember
  })
}
