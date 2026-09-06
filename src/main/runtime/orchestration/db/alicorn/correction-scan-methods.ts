import type { OrchestrationDb } from '../orchestration-db'

type AlicornCorrectionScanRow = {
  worktree_id: string
  last_scanned_at: string
  last_commit: string | null
}

export function getCorrectionScan(
  this: OrchestrationDb,
  worktreeId: string
): { lastScannedAt: string; lastCommit: string | null } | null {
  const row = this.db
    .prepare('SELECT * FROM alicorn_correction_scans WHERE worktree_id = ?')
    .get(worktreeId) as AlicornCorrectionScanRow | undefined
  if (!row) {
    return null
  }
  return { lastScannedAt: row.last_scanned_at, lastCommit: row.last_commit }
}

export function setCorrectionScan(
  this: OrchestrationDb,
  worktreeId: string,
  lastScannedAt: string,
  lastCommit: string | null
): void {
  this.db
    .prepare(
      `INSERT INTO alicorn_correction_scans (worktree_id, last_scanned_at, last_commit)
       VALUES (?, ?, ?)
       ON CONFLICT(worktree_id) DO UPDATE SET
         last_scanned_at = excluded.last_scanned_at,
         last_commit = excluded.last_commit`
    )
    .run(worktreeId, lastScannedAt, lastCommit)
}

export type CorrectionScanMethods = {
  getCorrectionScan: typeof getCorrectionScan
  setCorrectionScan: typeof setCorrectionScan
}

export function attachCorrectionScanMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getCorrectionScan,
    setCorrectionScan
  })
}
