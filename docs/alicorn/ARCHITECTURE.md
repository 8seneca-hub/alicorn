# Alicorn — Architecture

## 1. What Alicorn is

Alicorn is a desktop application and control plane for running software work through teams of AI
agents. A team is configured once: named **Members** (a role bound to an agent backend, a skill set,
a permission mode and a workspace kind), arranged into a **Workflow** of stages with triggers between
them. Agents execute the stages and hand work to each other. A human is interrupted only at
**gates** — steps that are irreversible, carry an inherited decision, or lack the evidence to run
unattended.

Every step is recorded. The record is what makes reducing human involvement defensible, and it is the
product's durable asset.

## 2. Principles

1. **Execution is on the client.** Agents run on the employee's machine under the employee's own
   subscription. Alicorn never hosts inference, never holds a model key, never resells capacity.
2. **The control plane is small.** Identity, policy, a ledger, a relay, object storage. Ordinary
   stateless web services over one Postgres.
3. **Multi-tenant in shape, single-tenant in deployment.** `tenant_id` on every row from day one,
   enforced by row-level security, even where it is a constant.
4. **Additive wire changes only.** Desktop clients and servers update independently. New RPC methods
   and optional parameters are safe; new stream opcodes must be capability-negotiated.
5. **The ledger is append-only and exactly-once.** A ledger that double-counts is worse than no
   ledger, because the autonomy policy reads from it.
6. **Buy identity, build policy.** Identity is a solved problem. What a role may approve is product
   logic and changes weekly.

## 3. Components

| Component | Responsibility | Runtime | State |
|---|---|---|---|
| **Alicorn Desktop** | Worktrees, terminals, agent processes, member sessions, UI | Electron | Local SQLite + files |
| **Alicorn CLI** (`alicorn`) | Same runtime headless; used by agents and CI | Node | — |
| **Keycloak** | OIDC provider, organisations, SSO/SAML, LDAP/AD, SCIM | JVM (Quarkus) | Postgres |
| **Control API** | Members, workflows, autonomy policy, org→policy mapping, relay tokens | Node | Postgres |
| **Ledger API** | Step outcomes, verifications, gate decisions, track record | Node | Postgres |
| **Relay** | Device pairing, stream fan-out to mobile and remote clients | Node | Redis |
| **Object store** | Reports, artifacts, exported trails | S3-compatible | — |

Control API and Ledger API are separate services because they have different write profiles,
different retention rules and different blast radius. They share a Postgres instance until measurement
says otherwise.

**The board rule engine is not a service.** It runs in Alicorn Desktop's main process as an
in-process coordinator, owns a system Run per project (`coordinator_handle = 'board:<repoId>'`),
and calls the same internal functions the `orchestration.taskCreate` / `orchestration.workerStart`
handlers call after their run-scope checks. A board dispatch is therefore an ordinary
`dispatch_contexts` row with Member provenance, and reaches the ledger through the outbox like any
other. Guard rails — dispatch ceiling, column-revisit loop detection, kill switch — are state in the
orchestration SQLite (`alicorn_board_transitions`, `alicorn_board_automation_state`), never prompts.

### A board rule is a degenerate one-stage workflow

This is the relationship to keep straight, because the two features look independent and are not:

| Workflow (WF1, v1.5) | Board rule (BA1, v1.0) |
|---|---|
| stage with `key`, `member_id`, `required_checks` | rule with `toStatusId`, `memberId`, `promptTemplate` |
| transition fires the next stage | a column change fires the rule |
| `stage.key` → `step_outcomes.stage_key` | `to_status_id` → *(see below)* |
| `reversibility` / `inherited_cost` authored on the stage | not expressible — every board dispatch is `single` and ungated |

A board rule is what a one-stage workflow degenerates into when there is no graph to walk: one
trigger, one member, one prompt. When workflows land (**WF3**), a board column becomes a stage
trigger and `to_status_id` becomes the stage key rather than a parallel concept. Nothing about the
board's storage needs to change for that — `alicorn_board_transitions` already records the
destination column per transition, which is the value a stage key would carry.

**`to_status_id` reaches `step_outcomes.stage_key`.** The step-outcome builder resolves a settled
dispatch back to the board transition that started it and uses the destination column as the stage
key (`src/main/alicorn/step-outcome-builder.ts`). The column **wins over the worker's own
`--phase`**: the stage a member is measured under is authored config, never something the member
being judged chooses for itself — the same rule that keeps required checks off the member. A
dispatch with no board transition still falls back to the reported phase, then to `'build'`.

This is what makes per-stage track record mean anything: `member_stage_stats` is keyed on
`(member_id, stage_key)` and the autonomy policy reads it, so a reviewer dispatched by an
*In Review* column must not accumulate its record mixed in with implementation work.

## 4. Topology

```
EMPLOYEE MACHINE                          CONTROL PLANE
┌───────────────────────────┐            ┌────────────────────────────────┐
│ Alicorn Desktop           │            │  Keycloak      (stateless)     │
│  ├ git worktrees          │  HTTPS     │  Control API   (stateless)     │
│  ├ folder workspaces      │◄──────────►│  Ledger API    (stateless)     │
│  ├ Claude Code / Codex /  │   WSS      │  Relay         (sticky)        │
│  │  Grok / OpenClaude     │            ├────────────────────────────────┤
│  ├ terminals (PTY)        │            │  Postgres  ·  Redis  ·  S3     │
│  └ local ledger queue     │            └────────────────────────────────┘
└───────────────────────────┘
        │                                 MOBILE / REMOTE
        └── SSH / WSL hosts ──────────────► via Relay
```

All execution — agents, git, tests, builds — happens in the left box. The right box stores decisions
and brokers connections.

## 5. Identity

**Status:** Deferred. Tier 1 authenticates with a shared bearer (`ALICORN_LOCAL_API_TOKEN`) and a
constant tenant (`ALICORN_TENANT_ID`); the middleware seam (`requireTenant`) is where Keycloak plugs
in as a second auth mode. When it does: tenant id = Keycloak organisation id, proven by the token's
`organization` claim.

**Keycloak 26+.** Apache 2.0, OIDC provider, and Organizations (GA in 26) gives thousands of
organisations inside one realm — the SaaS-shaped tenancy model, rather than realm-per-tenant which
does not scale past a few hundred.

- Desktop authenticates directly against Keycloak by OIDC + PKCE.
- On first login the Control API maps the Keycloak subject to an internal `user_id` and stores the
  mapping. **Everything internal keys off `user_id`, never off the IdP subject**, so the IdP stays
  swappable.
- Keycloak owns: who a person is, which organisation, SSO, group membership.
- Control API owns: which members and stages a role may configure or loosen. This is product policy,
  not identity.

## 6. Data model

Core tables. All carry `tenant_id`; row-level security is enabled on every one.

*Status:* identity tables land with the Keycloak plan; tier 1 runs auth mode `local` with a constant
`tenant_id`.

```sql
-- Identity mapping ------------------------------------------------------
users            (id, tenant_id, idp_subject UNIQUE, email, created_at)
org_roles        (tenant_id, user_id, role)          -- owner|admin|member
seats            (tenant_id, user_id, kind)          -- builder|collaborator

-- Product configuration -------------------------------------------------
members          (id, tenant_id, name, role, backend, workspace_kind,
                  permission_mode, system_rules, created_at,
                  UNIQUE (tenant_id, name))            -- members_tenant_name
member_skills    (member_id, skill_id)
workflows        (id, tenant_id, project_id, name, version,
                  created_by, created_at, updated_at,
                  UNIQUE (tenant_id, project_id, name))  -- workflows_tenant_project_name
stages           (id, tenant_id, workflow_id, key, name, ordinal, member_id,
                  kind,                 -- worker|code  (code: no member, no model; runs code_command)
                  code_command,         -- WF5; WF1 ships worker stages only
                  reversibility,        -- free|contained|irreversible
                  inherited_cost,       -- low|high
                  required_checks jsonb,
                  UNIQUE (workflow_id, key))             -- stages_workflow_key
transitions      (id, tenant_id, workflow_id, from_stage, to_stage, trigger jsonb,
                  kind,                 -- forward|correction  (WF2; the learning edge is the Rulebook, not a row here)
                  UNIQUE (workflow_id, from_stage, to_stage))
                  -- vocabulary: docs/alicorn/GRAPH-ENGINEERING.md
org_policies     (tenant_id, enforce_distinct_reviewer_backend,
                  updated_by, updated_at)
project_required_checks(tenant_id, project_id, checks jsonb,
                  updated_by, updated_at)
                  -- project-scoped until stages exist (v1.5); authored by an org admin, never by the member being judged
                  -- once a stage exists, stage.required_checks wins and this is the fallback (WF1)

-- Autonomy --------------------------------------------------------------
autonomy_policies(id, tenant_id, project_id, stage_key, member_id, mode,
                  min_runs, min_accept_rate, max_files, max_spend_cents,
                  created_by, expires_at, created_at)

-- Ledger (append-only) ---------------------------------------------------
step_outcomes    (id, tenant_id, run_id, task_id, dispatch_id, project_id,
                  repo_id, worktree_id, branch, member_id, backend, -- backend: claude|codex|grok|openclaude|other|code
                  stage_key, execution_strategy, outcome, files_modified,
                  report_summary, spend_cents, usage,
                  gate_decision, gate_reason, gate_id,
                  human_verdict, amended_after_ms, -- written once by the corrections watcher (follow_up_commit | revert | reopened_task) or by hand
                  review_backend_bypass, escalation_offered, escalation_accepted,
                  client_ts, created_at,
                  UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id))
step_verifications(id, tenant_id, run_id, task_id, dispatch_id, kind, name,
                  required, status, detail, created_at,
                  UNIQUE (tenant_id, dispatch_id, kind, name))
step_interruptions(id, tenant_id, run_id, task_id, dispatch_id,
                  kind,                 -- gate|ask|escalation
                  source_id, resolved_by, occurred_at, created_at,
                  UNIQUE (tenant_id, kind, source_id))
                  -- exactly-once on (tenant_id, kind, source_id); the north-star metric counts these
decision_gates   (id, tenant_id, run_id, task_id, question, options,
                  status, resolution, resolved_by, resolved_at, created_at)
                  -- v1.0 (gate policy); tier 1 keeps Orca's client-side decision_gates
context_captures (id, tenant_id, run_id, task_id, dispatch_id,
                  prompt | prompt_path, prompt_bytes, context_slice, created_at)

-- Derived (rebuildable from step_outcomes) -------------------------------
member_stage_stats(tenant_id, member_id, stage_key, project_id,
                  runs, accepted, accept_rate, last_amended_at, level,
                  updated_at)
```

### Rules that keep a workflow honest

- **The wire addresses a stage by `key`, not by id.** Ids stay internal, so a save is idempotent, a
  reorder is one request, and WF3's board-column bindings point at something stable. `key` is already
  the ledger's join column (`step_outcomes.stage_key`, `autonomy_policies.stage_key`).
- **`version` is optimistic concurrency, not a published snapshot.** It is bumped on every successful
  save; a client sends the version it read and a mismatch is rejected. Nothing pins a version to a run
  until stages bind to dispatch (WF3).
- **Ordinals are contiguous from zero, enforced on the wire.** There is deliberately no unique index on
  `(workflow_id, ordinal)` — it would fail mid-statement on a reorder.
- **Stage checks win over project checks; an empty stage list still wins.** Only a *missing* stage falls
  back to `project_required_checks`, so a stage never silently inherits a rule it did not author.
- **Templates ship in code, not in a table.** A template names a *role*; instantiation binds the
  tenant's member holding it, and a role with no member leaves the stage unassigned. Keys therefore
  come from templates rather than free-text `phase` — the set SK1 consumes is
  `FEATURE_DELIVERY_STAGE_KEYS`.
- **Deleting a member unassigns its stages** (`ON DELETE SET NULL`). An unassigned stage is a visible,
  fixable state; a vanished workflow is not.
- **A code stage runs on the machine it is authored for, or not at all.** `code_command` is executed
  through `runProcess` on the desktop; `worktree_path` is a path on the *execution* host, so an
  SSH-hosted workspace refuses rather than running the command locally, where it would either fail or
  find a same-named local directory and report success for work that never happened.
- **A code stage takes an edge or gates; it never simply stops.** Exit 0 takes `on_success`, any other
  exit takes `on_failure`, and a failure with no correction edge raises a gate with reason
  `unverified`. Exit 0 is the only success, and a timeout is recorded as exit 124 rather than an
  absent code — an outcome has to be `succeeded` or `failed`.

### Rules that keep the ledger honest

- **Exactly-once.** The unique constraint on `(tenant_id, run_id, task_id, stage_key, dispatch_id)`
  absorbs duplicate `worker_done` deliveries from retries, reconnects and federation replay — an Orca
  retry is a new dispatch, so it is a new step, not a duplicate.
- **The outbox delivers writes.** The desktop enqueues each settled step in `ledger_outbox` (in Orca's
  orchestration SQLite) inside the settlement transaction and a drainer posts it; the unique key
  absorbs replays.
- **Server time orders everything.** `created_at` is assigned server-side. `client_ts` is kept for
  forensics only — outcomes originate on laptops and SSH hosts with unreliable clocks.
- **Offline writes reconcile.** The desktop queues outcomes locally with a monotonic per-device
  sequence and replays on reconnect. Windows are computed by server time, so a late batch cannot
  retroactively promote a member. Tier 1 ships the outbox without a per-device sequence — server time
  still orders.
- **`member_stage_stats` is a cache.** Updated on write, rebuildable from the ledger. Gate evaluation
  reads it; nothing else may write it.
- **A code stage is a step like any other.** It records a `step_outcome` with `backend: 'code'`, no
  `member_id`, and a synthetic `dispatch_id` derived from its task — it dispatches nobody, and the
  column is `NOT NULL`. `code` is deliberately not a member backend: no member can be configured to
  run one. No spend row follows (there is no model) and no verification row (diff coverage measures a
  member's diff), and a stage that refused to run records nothing at all rather than inflating the
  counts the autonomy policy reads.
- **A verdict is written once.** `human_verdict` is set by the first signal (a follow-up commit, a
  revert, a reopened task, or a person); a later, different signal is a new event to log, never an
  overwrite.
- **Dead rows are kept.** A row the Ledger API rejects with a non-retryable error, or that fails 50
  times, is marked `dead_at`/`dead_reason`, listed by `orca ledger outbox --dead` and requeued by
  hand with `orca ledger outbox-requeue --id <id>` (or `--all` to requeue every dead row, optionally
  scoped with `--kind`); it is never deleted. A dead row keeps its `dedupe_key`, so requeueing cannot
  double-count — while a row stays dead, a producer that re-enqueues the same step sees
  `duplicate: true` and treats it as already recorded, not as a reason to enqueue a second time.
- **Required checks do not block ledger delivery.** A `step_verification` row runs a project's own
  command, so it drains in its own worker with a row timeout; the ordinary writes never queue behind
  it. A timeout is retryable — a slow project is not a permanent failure.
- **Single writer.** Neither the drainer nor the verification worker leases a row before processing
  it, so correctness rests on exactly one process owning a given `orchestration.db` at a time; a
  second process against the same userData is not supported today.

## 7. Autonomy policy

Evaluated when a step completes and the workflow is about to hand off. Hard stops are checked first,
so accumulated evidence can never retire a gate protecting something irreversible.

```
evaluateGate(step, policy, evidence):
  policy.mode == 'always_gate'          -> gate('policy')
  step.reversibility == 'irreversible'  -> gate('irreversible')
  step.inherited_cost == 'high'         -> gate('inherited')
  !evidence.all_required_checks_passed  -> gate('unverified')
  evidence.files  > policy.max_files    -> gate('blast:files')
  evidence.spend  > policy.max_spend    -> gate('blast:spend')
  evidence.touched_protected_path       -> gate('blast:reach')
  stats.runs        < policy.min_runs   -> gate('history')
  stats.accept_rate < policy.min_accept -> gate('accept-rate')
  stats.recent_regression               -> gate('regression')
  -> auto
```

`reversibility` and `inherited_cost` are **authored on the stage**, never inferred. A system that
guesses which step is irreversible guesses wrong once, and that once is a production deploy.

**As built (GP1, 2026-09-08).** `evaluateGate` is a pure function
(`src/main/alicorn/gates/evaluate-gate.ts`) in exactly this order, with two clarifications the
pseudo-code left open. An unexpired `never_gate` returns `auto` *after* the two hard stops and
before the evidence checks, so a standing exception buys a project out of its track record but
never out of an irreversible step; a lapsed or unparseable expiry falls back to `evidence`. Every
`null` in the evidence is a gate, not a pass — unknown required checks and unknown protected-path
reach both read `unverified`, an unknown file count or spend reads as the budget it could not be
checked against, and an absent track record reads `history`.

Tier 1 has no stages, so the two authored attributes live in `project_stage_config`
(project + stage key, Control API), defaulting to `irreversible`/`high` for `merge` and `deploy`
and `contained`/`low` for everything else. They become `stages.*` once a workflow is attached.

### Levels

| Level | Entry | Behaviour |
|---|---|---|
| 0 Observed | default | Always gates. Records the decision it *would* have made. |
| 1 Advisory | runs ≥ 10 | Gates, pre-fills a recommendation, measures agreement. |
| 2 Conditional | runs ≥ 20, accept ≥ 0.90 | Auto when verified and inside budget. |
| 3 Autonomous | runs ≥ 50, accept ≥ 0.95, no amendment in 20 | Notifies instead of blocking. |

**Demotion:** one `rejected`, or two `amended` within the last ten runs, drops the stage one level
immediately and requires the full entry condition again. Windows are the last 50 runs, not lifetime —
a member with 400 good runs must not average its way out of 12 recent bad ones.

`member_stage_stats.accept_rate` remains machine-derived — it counts the outcome the agent reported.
Demotion is evaluated from `step_outcomes.human_verdict` (written by the corrections sweep), never
from `accept_rate`.

**As built (GP2, 2026-09-08).** The windowed record is `GET /v1/ledger/track-record?memberId&stageKey&projectId`,
computed from the last 50 raw `step_outcomes` at read time rather than from `member_stage_stats`,
whose aggregate is lifetime. `summarizeTrackRecord` and `computeAutonomyLevel`
(`cloud/packages/control-plane-contract/src/track-record.ts`) hold the arithmetic and the level
table. The level is **derived and stored nowhere** — `member_stage_stats.level` is still unwritten
— because nothing consumes it to retire a gate yet; that is SK1's, and `evaluateGate` never sees
it. It is named *track record*, not *evidence*: `GateEvidence` is the wider shape (required checks,
blast radius, track record) assembled on the client, and one word for two shapes is how the two
drift apart.

**The corrections watcher is load-bearing.** `human_verdict` must also be written from post-hoc
corrections — a follow-up commit touching the same files inside a window, a revert, a reopened task.
Without it, accept rate drifts up while quality drifts down. Until it ships, run advisory-only.
Shipped 2026-09-07: the watcher runs every ten minutes per worktree and classifies without
commit-author identity — see `src/main/alicorn/corrections/`.

## 8. API surface

Additive over Orca's existing orchestration RPC. No protocol version bump.

| Method | Purpose |
|---|---|
| `orchestration.gateCreate` | Existing. Gains optional `evaluate: boolean` and `stageKey`. When set, the server runs the policy and records the decision it would have made on the gate row (`recommended_decision`, `recommended_reason`). |
| `orchestration.gateResolve` | Existing. |
| `orchestration.verifyRecord` | Record named check results for a task. |
| `orchestration.policySet` / `policyGet` | Read and write autonomy policy; `policySet` records `created_by` and a mandatory expiry for `never_gate`. |
| `orchestration.evidence` | Track record for `(project, stage, member)` plus what the policy would decide now. |

Evaluation lives inside `gateCreate` rather than a separate "should I gate?" call, so a caller cannot
ask the policy and then ignore the answer. The ledger stays authoritative.

**As built (GP1, 2026-09-08).** `gateCreate { evaluate }` returns `{ gate, recommendation }` and the
gate is always pending: **nothing auto-resolves**. Level 0 records the decision it would have made,
which is how a level is ever earned — autonomy is unlocked by evidence, and evidence only
accumulates by running gated. Retiring a gate on an `auto` recommendation is SK1's, once the Ledger
API serves the windowed track record (GP2 — shipped; `evaluateGateForTask` now reads it, so a
stage with a real record can reach `auto` as a *recommendation*, and still gates).

**As built (GP2, 2026-09-08).** `policyGet`, `policySet`, `policyList` and `evidence` are the four
methods, all reached through `MemberDirectory` so a policy read is cached for 60 s and a write
evicts what it invalidates. `policySet` is the only mutation of the four and is declared as one in
`orchestration-rpc-contract.ts`; it is a *replace*, so an omitted budget clears it. A `never_gate`
with no expiry — or one already lapsed — is rejected before the write leaves the process, which is
the third place that rule is enforced after zod and the DB CHECK. `policyList` is the §9 audit view:
it lists lapsed exceptions as well as standing ones, because when an exception ended is part of the
audit, and it shares `hasPolicyExpired` with the evaluator so the two can never disagree about which
are live. `evidence` is keyed on a **task**, not on the three ids, so it runs the same
`evaluateGateForTask` assembly `gateCreate` does — one implementation of a gate verdict, never two
that could disagree — and returns `wouldDecide` alongside the track record and the evidence it was
computed from. Reading it resolves nothing.

`verifyRecord` writes to the client's own store (`alicorn_dispatch_verifications`), which is what
the policy reads: the Ledger API is authoritative but eventual, and a gate has to decide now. D5's
verification worker mirrors its own results to the same table on the way out, so an automated
diff-coverage result and a hand-recorded one reach the policy through one path. A manually recorded
check does **not** reach the ledger in GP1 — that needs a new outbox kind, and the outbox is the
only path a ledger write may take.

## 9. Security

- **No model keys.** Agents authenticate with the user's own subscription on the user's own machine.
- **Least privilege at the tenant boundary.** Row-level security in Postgres; the application role
  cannot read across tenants even with a bad query.
- **Standing exceptions expire.** `never_gate` requires an author and an expiry, and surfaces in the
  audit view until it lapses.
- **A member cannot loosen its own criteria.** Required checks are authored on the stage, not by the
  member being judged.
- **Blast-radius budgets are per run**, not per task, so splitting a large change into small tasks
  does not launder past the limit.
- **Export is a first-class feature.** Auditors ask for the trail; make it a signed, dated export
  rather than a screenshot.

## 10. Non-goals

- Hosting agent execution or inference.
- Replacing the repository, the tracker or CI. Alicorn sits between them.
- A queue, an event bus or a column store, until a measurement demands one.
