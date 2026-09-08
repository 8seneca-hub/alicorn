import { ORCHESTRATION_LEGACY_RUN_ID } from '../../../../shared/orchestration-rpc-contract'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'

export const LEGACY_RUN_ID = ORCHESTRATION_LEGACY_RUN_ID

export const LEGACY_CONTRACT_VERSION = 0
export const CURRENT_CONTRACT_VERSION = ORCHESTRATION_CONTRACT_VERSION

// Schema versions: v2 'heartbeat'+last_heartbeat_at, v3 delivered_at, v4 task-creator terminal, v5 task_title/display_name, v6 pane identity, v7 lightweight Runs, v8 crash-safe Run deliveries, v9 durable question threads, v10 Dispatch capabilities, v11 durable mutation receipts, v12 composed worker state, v18 post-v6 version-skew repair, v19 adopted legacy Runs and compatibility receipts, v20 legacy question backfill, v21 legacy scheduler-loss provenance, v22 dispatch assignee lookup, v23 worker terminal resource ownership, v24 creator-incarnation authority, v25 active Dispatch handle lookup, v26 indexed mutation receipt capacity, v27 durable federation acknowledgments, v28 durable local mutation caller identity, v31 alicorn: ledger_outbox, alicorn_task_strategy, alicorn_dispatch_members, v32 indexed dispatch_contexts(status, completed_at) for the run-cost publisher's recent-dispatch scan, v33 ledger_outbox kinds 'human_verdict_patch'/'interruption', alicorn_correction_scans, alicorn_dispatch_ledger, v34 alicorn_board_transitions and alicorn_board_automation_state for board automation, v35 alicorn_dispatch_ledger.files_modified for the corrections sweep, v36 idx_board_transitions_dispatch on alicorn_board_transitions(dispatch_id) for the step-outcome builder's per-dispatch lookup, v37 ledger_outbox dead_at/dead_reason for permanently-rejected rows, v38 alicorn_dispatch_verifications and decision_gates.recommended_decision/recommended_reason for the autonomy policy (GP1), v39 alicorn_task_worktrees for the multi-repo feature workspace (MR1).
export const SCHEMA_VERSION = 39
