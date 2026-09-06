// Board automation's own tables, kept out of create-alicorn-tables-sql.ts so the ledger module and
// the board module do not share a schema file (OWNERSHIP: shared files, additive only).
export function createAlicornBoardTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS alicorn_board_transitions (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  worktree_id     TEXT NOT NULL,
  task_id         TEXT,
  dispatch_id     TEXT,
  from_status_id  TEXT,
  to_status_id    TEXT NOT NULL,
  rule_id         TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('dispatched', 'refused_ceiling', 'refused_loop', 'refused_killed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Why: every guard decision reads "this worktree's transitions since <time>" — the ceiling counts
-- them and the loop detector walks them. Without this the guards scan the whole table each move.
CREATE INDEX IF NOT EXISTS idx_board_transitions_worktree ON alicorn_board_transitions(worktree_id, created_at);

-- Why: the step-outcome builder resolves a settled dispatch back to the column that triggered it,
-- so stage_key reflects the board rather than the worker's own --phase.
CREATE INDEX IF NOT EXISTS idx_board_transitions_dispatch ON alicorn_board_transitions(dispatch_id);

-- Why: refusals are recorded, not just dispatches, so a board that silently stopped dispatching can
-- be explained from history rather than from logs.
CREATE TABLE IF NOT EXISTS alicorn_board_automation_state (
  scope        TEXT PRIMARY KEY,
  disabled_at  TEXT,
  disabled_by  TEXT
);
  `
}
