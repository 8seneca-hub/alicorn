@AGENTS.md

# Alicorn

This repository is a fork of [Orca](https://github.com/stablyai/orca) (MIT). `AGENTS.md` above carries
the inherited engineering conventions and still applies in full. This file carries what is specific to
Alicorn: what we are building, and the decisions that are easy to get wrong.

Planning documents live in [`docs/alicorn/`](docs/alicorn/) and are authoritative over anything below:
[PROJECT-BRIEF](docs/alicorn/PROJECT-BRIEF.md) · [ROADMAP](docs/alicorn/ROADMAP.md) ·
[ARCHITECTURE](docs/alicorn/ARCHITECTURE.md) · [INFRASTRUCTURE](docs/alicorn/INFRASTRUCTURE.md) ·
[DESIGN-SYSTEM](docs/alicorn/DESIGN-SYSTEM.md). Implementation plans live in
[`docs/alicorn/plans/`](docs/alicorn/plans/). If this file disagrees with them, they win — and fix
this file.

## What we are building

An **ADE — an agent development environment**. The user is a developer who now spends the day
directing agents rather than typing. The unit of work is a ticket, not a file. Named **Members**
(a role bound to a backend, a skill set, a permission mode and a workspace kind) are arranged into
**Workflows**, agents hand work to each other, and a human is interrupted only at **gates**.

Every step is recorded. That record is the product's durable asset — it is what makes reducing human
involvement defensible.

**North-star metric: `interruptions_per_completed_task`.** When a change is hard to judge, ask whether
it moves that number down without moving quality down with it.

## Four pillars

These are working constraints, not marketing. A change that harms one needs a stated reason.

1. **Context efficiency.** State belongs on disk, not in a context window. Quality degrades around
   300–400k tokens, so ceilings are enforced well before the window is full — never at 100%.
2. **Token efficiency.** A team of agents costs roughly an order of magnitude more than one agent.
   Never spend that by default; make the user opt in, and show the meter while it runs.
3. **Quality.** Done is a set of machine-checkable gates, not an opinion. Two rules do double duty by
   cutting cost _and_ raising quality: a reviewer never runs on the author's backend, and a QA member
   never reads the implementation it is testing.
4. **A UI you can drive.** One tab per ticket, with status and running cost visible without opening
   anything.

## Execution: two axes, not three modes

An earlier draft had three exclusive modes (Direct, Team, Foreman). That was wrong — see
PROJECT-BRIEF §04 — and the fix is cheaper than what it replaced. Two independent axes express every
case:

|                                        | Workflow **not** attached                                                          | Workflow attached                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **`execution_strategy: single`**       | Today's Orca: brief one agent in one session. ~90% of daily work. **The default.** | The Workflow feature: a column change dispatches a member; stages, gates, autonomy levels. _Not a mode._ |
| **`execution_strategy: orchestrated`** | One big ticket decomposed by a lead (Foreman). ~10–15× tokens.                     | One stage decomposed, the rest run single. The case three modes could not express.                       |

- **`execution_strategy` is a field on a task (later a stage), values `single` | `orchestrated`.**
  `single` is the default and stays genuinely the default; anything that makes `orchestrated` the
  default path is wrong.
- **Escalation is per task and is offered, never applied silently.** When a single-agent session
  crosses the context ceiling (300k tokens; quality degrades around 300–400k, never wait for 100%)
  or turns out to touch more than one repo, Alicorn _offers_ to switch that task to `orchestrated`
  and records whether the offer was accepted. Nothing about an attached workflow changes when it is.
- **"Team mode" does not exist.** It was the Workflow feature under a second name. Do not reintroduce
  the word.
- Multi-agent is a trade, not an upgrade — the public figure is ~90% better results for ~15× the
  tokens, measured on research tasks, not on shipping features. We have not measured it on our own
  repos yet (see _Decisions_ → success criteria).

## Foreman is an add-on

Foreman is what runs when a task or stage has `execution_strategy: orchestrated`: the optional lead
layer for long-running, multi-repo work. Everything else must keep working with Foreman absent — if a
change makes the base depend on it, that change is wrong.

It is the industry's **orchestrator-subagent** pattern (LangGraph calls it _supervisor_, OpenAI calls
it _manager_). Inherit the proven core: a fresh context window per subagent, a self-contained task
description with an explicit output format, subagents that cannot coordinate mid-task, and a lead that
synthesizes and re-plans. Say so in docs rather than presenting it as novel.

Three places we go deliberately stricter than the standard pattern, and these are ours to keep:

- The lead **writes no code and reads no implementation**. The canonical orchestrator handles some
  subtasks itself; ours does not.
- Returns are **schema-bounded with a hard token ceiling**. Overflow is written to a file and returns
  a path. Enforced, not advised.
- State is **on disk** (the Feature Journal), so a run survives the session that started it.

## Naming: do not overload "ledger"

**`Ledger` means the append-only measurement ledger** — `step_outcomes`, `step_verifications`,
`member_stage_stats`. It is the substrate the autonomy policy reads from. Never reuse the word.

The Foreman structure holding typed interfaces between repos is the **Contract Registry**, never the
"contract ledger". Getting this wrong makes the autonomy code and the Foreman code sound like the same
subsystem, and they have opposite retention, write profile and blast radius.

**Do not introduce a new field or concept called "mode".** The word is already taken twice —
`permission_mode` on a member and `mode` on an autonomy policy. The single-vs-orchestrated choice is
`execution_strategy`, and nothing else.

## Graph vocabulary

The industry's _graph engineering_ framing — splitter, worker, code node, gate; a short **correction
edge** and a long **learning edge**; gate by blast radius, not confidence — maps onto Alicorn one to
one. [GRAPH-ENGINEERING.md](docs/alicorn/GRAPH-ENGINEERING.md) has the mapping and the sources. Use
its names where they apply: a **code stage** runs with no model and no member; the return transition
is a **correction edge**; the Rulebook is the **learning edge**. Two deliberate differences: the gate
is a property of every hand-off, not a node (that is what makes _hard stops never retire_
enforceable), and the splitter is `execution_strategy: orchestrated`, not a stage kind. Graphs are
still not the default path — `single` is.

## Invariants that are expensive to violate

From [ARCHITECTURE.md](docs/alicorn/ARCHITECTURE.md) — worth repeating because each has already been
decided and the cost of relitigating them mid-change is high.

- **Execution is on the client.** Agents run on the user's machine under the user's own subscription.
  Alicorn never hosts inference and never holds a model key.
- **The ledger is append-only and exactly-once.** A ledger that double-counts is worse than none,
  because the autonomy policy reads it. Server time orders everything; `client_ts` is forensics only.
- **Hard stops never retire.** Merge, deploy and irreversible or inherited-cost steps gate regardless
  of accumulated track record. `reversibility` and `inherited_cost` are authored on the stage, never
  inferred — guessing wrong once is a production deploy.
- **A member cannot loosen its own criteria.** Required checks are authored on the stage, not by the
  member being judged.
- **Guard rails ship with the feature that needs them**, never after. Loop detection lands with board
  automation; blast-radius budgets land with Level 2.
- **Autonomy is unlocked by evidence, and evidence only accumulates by running gated.** Until the
  corrections watcher ships, advisory mode only.
- **Wire changes are additive or capability-negotiated.** No exceptions; the failure is silent.
- **`tenant_id` on every row** with row-level security, even where it is currently a constant.

## Interface decisions specific to Alicorn

Two deliberate departures from upstream. Both touch core files, so implement them precisely and
document them where a merge conflict will send someone looking.

- **A tab is a session, not a workspace.** Upstream keys its tab model to the workspace
  (`src/renderer/src/app-shell/reconcile-hydrated-workspace-tab-models.ts`). We key it to the agent
  session: one tab per ticket, panels split inside a tab, a workspace hosting many tabs. Each tab
  carries its own status and running cost.

  **As built (2026-09-07): the user-visible half shipped; the re-keying did not, and is no longer
  scheduled with it.** Status and running cost are both on the tab —
  `components/tab-bar/terminal-tab-activity-status.ts` rolls a tab's panes up to one status, and
  `terminal-tab-run-cost.ts` sums that tab's dispatches through D7's `summarizeRunCost`. Neither
  needed the tab model changed: the pane→tab relation lives in the **pane key**
  (`shared/stable-pane-id.ts`), not in `Tab`. The re-keying itself was measured before starting —
  `unifiedTabsByWorktree` appears in 174 non-test files, `tabsByWorktree` in 962 references — so it
  is its own ticket now, sequenced with the multi-repo feature workspace (MR1) that actually wants
  session-keyed tabs. Do not treat "a tab is a session" as blocking anything in the tab bar.

- **A new tab opens an agent, not a shell.** An IDE opens an editor because you were going to type; an
  ADE opens a live agent session with the chat box focused, because you were going to brief someone.
  The terminal moves to the right sidebar, one keystroke away. Reuse the existing `native-chat`,
  `right-sidebar` and `new-workspace` surfaces — this is a change of default, not new machinery.

  **As built (2026-09-07, corrected 2026-09-08).** The sidebar terminal is `RightSidebarTab 'terminal'`
  (`components/right-sidebar/terminal-panel/`), toggled with **`Mod+Backquote`** — not the `Cmd+J`
  the plan named, which is the worktree jump palette. It hosts the same `TerminalPane` the main area
  does, on a `TerminalTab` marked `surface: 'sidebar'` (`shared/terminal-tab-types.ts`): the tab
  carries the real `worktreeId`, so SSH hosts and folder workspaces resolve identically to the main
  view, and it deliberately has **no unified `Tab`** — no group, no layout leaf, no focus write —
  which is what keeps it out of the tab strip and the split layout. Keying it to
  `FLOATING_TERMINAL_WORKTREE_ID` was rejected: that id resolves to a null connection by design and
  could never reach an SSH host.

  **`TabGroup.surface` was the other half of a collision, and is retired (ALC-104).** Two PRs merged
  51 minutes apart shipped contradictory models of "a terminal outside the main tab area": a
  surface-owned `TerminalTab` with no unified tab, and a hidden `TabGroup` filtered out at
  `layoutSpanningGroups` and `selectHydratedActiveGroupId`. The group model lost because it needs a
  filter at _every_ layout reader — a third one would need a third filter — while an absent unified
  tab needs none. One predicate decides membership everywhere: `isSurfaceOwnedTerminalTab`.

  **Adding a right-sidebar tab means four edits, not one** — the union
  in `shared/ui-chrome-types.ts`, the guard in `store/right-sidebar-route.ts` (which silently
  rewrites an unknown tab to `explorer`), the activity-bar entry, and
  `STATIC_RIGHT_SIDEBAR_TABS` in `main/runtime/rpc/methods/client-ui-schemas.ts`, whose value-domain
  parity ratchet is what stops a paired client rejecting the whole `ui.set` payload.

## Multi-repo feature workspaces (MR1)

A task may bind **N (repo, branch, worktree) tuples** — one feature spanning repositories as one
workspace. The set lives in orchestration SQLite (`alicorn_task_worktrees`, `SCHEMA_VERSION` 39),
keyed by task, and it is **additive**: a task with no tuples is the pre-MR1 shape and every existing
path keeps resolving the one scalar worktree it always did. Model in
`src/shared/alicorn/feature-workspace-tuples.ts`, resolution in `resolve-feature-workspace-tuples.ts`.

Four things are easy to get wrong here, so they are decided:

- **Identity inside a set is the worktree, not the repo.** `folderWorkspaceToWorktree` gives every
  folder workspace in a project group the same `folder-workspace:<projectGroupId>` repo id, so a
  repo key collapses a two-folder feature workspace into one tuple. `repo_id` is a plain column;
  `duplicateGitRepoIds` is where "two branches of one git repo" gets caught.
- **The execution host is never stored on a tuple.** A repo can be re-homed under a bound task, and
  a cached host is a stale second source of truth whose failure mode is a client-side read of a
  remote path. Resolve it at use time through the existing fail-closed resolvers, which answer
  `unresolved`, never `local`.
- **A feature workspace may span hosts** — local frontend, SSH backend. Operations fan out per host
  (`groupTuplesByExecutionHost`), and a worker gets paths only for the tuples on its own host
  (`partitionTuplesByReachability`). That partition is by ownership, never liveness.
- **This does not re-key tabs.** UI5 is still its own ticket and its own persisted-schema migration;
  the tuple model sits alongside the worktree key rather than replacing it.

MR2's escalation signal reads `countTaskRepos(taskId) > 1`.

## Decisions taken — PROJECT-BRIEF §11, accepted 2026-09-06

Each was a recommendation in the brief; all seven were accepted as written. Treat them as settled.

1. **First slice accepted at 7–12 ew; the rest deferred.** Tier one (below) is committed. The other
   additions are revisited after v1.0 ships and the ledger has real numbers in it.
2. **The PR body is the v1.0 launch feature.** It is the headline, not a Foreman detail.
3. **The corrections watcher also feeds a Rulebook** — as a second consumer of an event we already
   build. v1.5, once there is amendment history worth reading.
4. **Reviewer backend ≠ author backend is enforced by default**, with an explicit opt-out, and every
   bypass is recorded in the run report.
5. **Upstream cut point: the day the rebrand CI gate goes green.** Merge greedily until then.
6. **Interface work is scheduled immediately after v1.0.** If it slips past v1.5 we have shipped an
   Orca with extra backend features and no visible identity of our own.
7. **Success is measured, not assumed.** Baseline `interruptions_per_completed_task` in v0.1; at v2.0
   compare Foreman against one developer on a real ticket (time to mergeable PR, total spend), with
   the threshold agreed _before_ the run.

## Tier 1 — the committed first slice (PROJECT-BRIEF §08)

Six items, all `extends`/`new`, all shipping with v1.0. Plans:
[`plans/2026-09-06-tier-1-control-plane.md`](docs/alicorn/plans/2026-09-06-tier-1-control-plane.md)
(cloud) and [`plans/2026-09-06-tier-1-desktop.md`](docs/alicorn/plans/2026-09-06-tier-1-desktop.md)
(desktop).

| #   | Item                                                     | Why first                                                                    |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `execution_strategy` on the task + escalation offer      | Must exist before board automation makes automated dispatch the default path |
| 2   | PR body posted from provenance data                      | The one item a stranger appreciates in ten seconds                           |
| 3   | Context capture — exact prompt and context slice per run | The only way to tell an underinformed member from a wrong one                |
| 4   | Diff coverage as a required check                        | Makes "tested" mean something                                                |
| 5   | Reviewer backend ≠ author backend, enforced              | Our sharpest quality claim; a policy check, not machinery                    |
| 6   | Per-run cost attribution surfaced while working          | Token efficiency has to be visible, not in a report nobody opens             |

**Dependencies pulled forward, deliberately.** Items 2, 5 and 6 need the Ledger and Members; item 4
needs required checks. Rather than wait for all of v0.1, tier 1 builds the _minimum_ product
substrate first — Control API, Ledger API, the Member entity — on the real control plane (next
section). Identity (Keycloak) is explicitly deferred to follow. The rest of v0.1 (rebrand, localisation, backend cutover, distribution)
is independent work and proceeds on its own track; do not block tier 1 on it or vice versa.

**Honest scoping inside tier 1.** Until workflows exist (v1.5) there are no stages, so required checks
are authored **per project** by an org admin — still never by the member being judged. Escalation
detects the context ceiling for Claude Code sessions; the "touches more than one repo" signal lands
with the multi-repo feature workspace (v2.0). Cost attribution covers Claude Code and Codex, the two
backends Orca already prices; others show "—", never a guess.

## Control plane: Postgres from day one — identity deferred

**Decided 2026-09-06: no local SQLite for Alicorn data.** Members, org policy, required checks and
the Ledger (`step_outcomes`, `step_verifications`, context captures, `member_stage_stats`) live in
Postgres behind the Control API and Ledger API, from the first commit — the same `pg` + inline-schema
idioms Orca's relay already uses in `cloud/`. Do not prototype any of these in a local store "for
now" — that is a migration we would pay for later.

**Identity (Keycloak) is deferred — also decided 2026-09-06.** Tier 1 runs auth mode `local`: one
constant tenant (`ALICORN_TENANT_ID`, default `local`) and one shared bearer
(`ALICORN_LOCAL_API_TOKEN`) between the desktop's main process and the services. Worker terminals
never hold the token. Everything is still multi-tenant in shape (`tenant_id` on every product row,
forced RLS), so Keycloak organisations arrive as a second auth mode behind the same middleware seam
(`requireTenant`) and the same client seam (`readAlicornBearer`) — not as a migration. Do not build
users, roles or sign-in in tier 1.

What stays local, and why:

- **Orca's existing orchestration SQLite** (runs, tasks, dispatches, gates, mail) is _execution
  state on the client_ and is untouched. It is not the ledger.
- **One transport table, `ledger_outbox`, in that same SQLite.** A settled `worker_done` enqueues a
  row in the same transaction that settles the task; a drainer posts it to the Ledger API within
  seconds and marks it sent. It exists only so that a crash between settlement and the network call
  cannot lose or double-count a step — the Ledger's exactly-once guarantee depends on it. It is a
  queue, never a data store: nothing reads it back except the drainer.

Where things live:

- `cloud/apps/control-api` — Members, org policy, project required checks (the desktop sign-in broker
  joins it with Keycloak).
- `cloud/apps/ledger-api` — append-only ledger writes, provenance and cost reads.
- `cloud/packages/control-plane-contract` — the wire contract both services and the desktop agree on.
- `cloud/dev/compose/` — `docker compose up` brings up Postgres 16 and both APIs; a seed script
  creates three members. INFRASTRUCTURE §3 applies: fifteen minutes to a working inbox or it is a
  bug.
- **Tenant is a constant for now; Keycloak organisation id later.** Requests carry the bearer and an
  optional `x-alicorn-org` header that must match; there is never a cross-service lookup on the hot
  path. Row-level security is `FORCE`d on every tenant-scoped table even with one tenant.

**Naming while the rebrand is pending.** New services, packages and environment variables are
Alicorn-branded from the start: `@alicorn-cloud/*`, `ALICORN_*`. Existing desktop code keeps its
`ORCA_*` names until the rebrand sweep renames all 886 at once; do not rename piecemeal, it makes the
CI grep gate lie.

## Fork posture: we own the core

**Decided: this is a hard fork.** We patch core directly and Alicorn becomes its own product, not a
plugin riding on someone else's app. Do not propose plugin-shaped workarounds to avoid touching core
files — that constraint no longer applies.

What still applies is that upstream ships most days (~500 merged PRs between two consecutive
releases), and much of that is platform grunt work we would otherwise have to learn the hard way:
Windows and WSL path handling, SSH reliability, Git version compatibility, EDR posture, the glibc
floor, crash reporting, i18n parity. So the question is not _whether_ to diverge — it is _when to stop
taking upstream's work_.

**Two phases, with an explicit cut point.**

1. **Track (now → rebrand complete).** Merge upstream often. The rebrand is configuration, copy and
   branding, which conflicts least with upstream work, so this is the cheapest window we will ever
   have to absorb their fixes. Take everything.
2. **Cut.** The day the rebrand CI gate goes green, pin the upstream tag and stop merging. Record the
   tag and commit SHA in `UPSTREAM_BASE` at the repository root. After this point, upstream is a
   source to _cherry-pick_ from — security fixes and platform bugs, chosen deliberately — never a
   branch to merge.

Before the cut, the deep interface work (tab model, agent-first surface) is what spikes divergence.
Sequence it after the rebrand so we are not paying merge costs on the files we are about to rewrite.

**What we must keep even after cutting:**

- `docs/reference/*.md` — the platform hazard notes (Windows EDR posture, WSL command execution, Git
  compatibility, SSH execution boundary, Linux glibc). This is the expensive, hard-won knowledge in
  this codebase, and it is worth more than the code it describes.
- The **ratchet tests** that enforce those hazards, such as the one failing on any new direct
  `child_process` import. Deleting a ratchet is how a fixed Windows bug comes back.
- **MIT attribution.** Retain `LICENSE` and the upstream copyright notice; add our own `NOTICE`
  alongside it. Rebranding the product does not remove the attribution requirement.

Keep the rebrand mechanical and CI-enforced: a surviving bare `orca ` invocation in the skill corpus
fails the build.

## The `/foreman` command

`.claude/commands/foreman.md` puts this session into lead mode: plan, dispatch subagents with
bounded briefs, keep a journal on disk, review on a different model, write no code. Templates live
in [`docs/alicorn/foreman-templates.md`](docs/alicorn/foreman-templates.md); journals are written to
`.foreman/` and are gitignored.

It is a **working prototype of the Foreman layer**, not a toy. Use it on real multi-repo work and
feed what breaks back into the design — the cost of learning that the bounded-report ceiling is
wrong is a few sessions here, versus a few weeks once it is shipped in the product.

Do not reach for it on ordinary single-concern work; it costs roughly an order of magnitude more,
and the command itself says so.

## Working in this repo

- Read `docs/alicorn/ROADMAP.md` before proposing scope. Releases are v0.1 Instrument → v1.0 Remove the
  babysitting → v1.5 Remove the hand-off → v2.0 Agents author the workflow, and the sequencing rules
  there are load-bearing rather than aspirational.
- The cross-agent mailbox is **v2.0**, not early. Anything that needs cross-backend hand-off today
  should ship on single-backend hand-off first.
- Prefer extending an existing Orca subsystem over adding a parallel one — see _Reuse Before
  Reimplementing_ in `AGENTS.md`. It applies with extra force here, because a parallel subsystem is
  also a permanent merge conflict.
- Renderer strings are localised by tooling, not by hand: write plain English, run
  `node config/scripts/localize-renderer-strings.mjs`, then `pnpm run sync:localization-catalog`.
  `verify:localization-coverage` fails the build on a bare string.
- Cloud services test against a real Postgres when `ALICORN_TEST_POSTGRES_URL` is set (same shape as
  the relay's `ORCA_RELAY_TEST_POSTGRES_URL`); without it those suites skip, they do not fake it.
- Anything written to the Ledger goes through the outbox. Never `fetch` the Ledger API directly from
  a settlement path. A dead outbox row is an operator signal (`orca ledger outbox --dead`), not
  garbage: it is kept, never deleted, and a human requeues it once the cause is fixed.
- A **code stage** runs its command through `runProcess` on the local machine and refuses an
  SSH-hosted workspace — `worktree_path` belongs to the execution host. It records a `step_outcome`
  with `backend: 'code'` and no member, and on a non-zero exit takes its correction edge or gates
  with reason `unverified`. It never simply stops.
- **Gate policy is evaluated only inside `gateCreate { evaluate }`** — there is deliberately no
  "should I gate?" RPC, so a caller cannot ask the policy and then ignore the answer. Policies,
  per-stage `reversibility`/`inherited_cost` and required checks are admin-authored per project in
  the Control API, never by the member being judged. Nothing auto-resolves a gate yet: GP1 records
  the decision it would have made and still blocks.
- Gates, questions and escalation offers are recorded as ledger interruptions at settlement; the
  north-star metric is `orca ledger report`. Human corrections (follow-up commits, reverts, reopened
  tasks) reach the ledger through the corrections sweep — never write `human_verdict` any other way.
