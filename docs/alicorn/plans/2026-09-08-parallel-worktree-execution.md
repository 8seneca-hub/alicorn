# Parallel worktree execution

**Written 2026-09-08.** Companion to
[`2026-09-08-remaining-work-sequencing.md`](./2026-09-08-remaining-work-sequencing.md). That plan
answers *what order*. This one answers *how many at once* — which of the 49 open tickets can be in
flight in separate worktrees simultaneously, and what has to be reserved up front so the merges later
cost less than the parallelism saves.

Baseline: `main` at `771f742c8`, 49 open tickets, all assigned to one person.

---

## 0. The governing rule

**Two branches are safe to run concurrently when they do not write the same *concept*. Disjoint files
is not the test.**

We already have the counter-example in the repo. PR #41 and PR #42 merged 51 minutes apart. They
touched *entirely disjoint files*, both were green on their own, and GitHub's mergeability check saw
nothing. They still shipped two contradictory models of "a terminal outside the main tab area" —
`TerminalTab.surface` and `TabGroup.surface` — and that is now `ALC-104` (UI6), unresolved on main.

So the partition below is by **owned concept**, not by file list. Where two tickets share a concept
they are serialized even when their diffs would merge cleanly.

---

## 1. Reserve these before opening any worktree

Three resources are allocated from a single global counter. A worktree that "takes the next one"
in isolation will collide with its sibling, and in two of the three cases git will *not* catch it.

### 1a. SQLite migration numbers — git will catch this, but messily

`SCHEMA_VERSION = 37` in `src/main/runtime/orchestration/db/contract-constants.ts`; the chain is in
`db/schema/migrate.ts`. **Next free is v38.** (Note LG3's ticket text says "v33 migration" — stale,
v33 has been `migrate-v33-alicorn.ts` for some time.)

Two worktrees each writing `migrate-v38-*.ts` produce two differently-named files that git merges in
happily, plus a conflict in `migrate.ts` and `contract-constants.ts`. The conflict is the only thing
that saves you, and resolving it carelessly leaves a version chain with a hole in it.

**Reserve at branch-creation time.** Nothing in Batch 1 is *known* to need a migration — none of the
tickets names one, and I have not traced each implementation far enough to promise that. So the table
starts empty and the rule is what matters:

| Version | Ticket | Notes |
|---|---|---|
| v38 | *unallocated* | claim here, in a commit to `main`, before writing the file |
| v39 | *unallocated* | |
| v40 | *unallocated* | |

MR1 is the most likely first claimant (repo/branch/worktree tuples need somewhere to live), but it may
land in the renderer's persisted workspace-session state rather than orchestration SQLite — check
before assuming. The rule holds either way: claim the number on `main` first, never inside the worktree.

### 1b. Postgres test database — git will NOT catch this

**The cloud Postgres suites use hardcoded schema names**, not randomized ones:

```
apps/ledger-api/src/schema-postgres.test.ts:6:  const schema = 'ledger_schema_test'
```

Two worktrees running `pnpm -r test` against the same database will `createTestSchema` /
`dropTestSchema` on the *same* schema concurrently.

**Reproduced on 2026-09-08**, primary worktree and the GP1 worktree both running the `ledger-api`
suite against `alicorn_test`, three rounds:

| Round | Result |
|---|---|
| 1 | both sides **33 passed** |
| 2 | both sides FAIL — `ledger routes (postgres)`, `ledger metrics (postgres)`, `schema > applies twice … forces RLS` |
| 3 | both sides FAIL |

Round 1 passing is the dangerous part: try it once, see green, conclude sharing is fine, then spend a
day chasing "flaky RLS tests" that are neither flaky nor about RLS. The database recovers on its own —
a solo run straight afterwards was 33/33 — so there is no lasting damage and no signal either.

The same two worktrees on separate slots (`alicorn_test` and `alicorn_test_c1`), run concurrently,
were 33/33 on both sides.

**One database per worktree slot, one shared container:**

```sh
docker exec alicorn-test-pg psql -U postgres -c 'create database alicorn_test_c1'
docker exec alicorn-test-pg psql -U postgres -c 'create database alicorn_test_c2'
docker exec alicorn-test-pg psql -U postgres -c 'create database alicorn_test_c3'
# then, per worktree:
export ALICORN_TEST_POSTGRES_URL="postgres://postgres:postgres@127.0.0.1:5433/alicorn_test_c1"
```

Cheap and sufficient — the container is shared, only the database differs. Randomising the schema
names in the suites would be the real fix and is worth a small follow-up ticket.

### 1c. Local stack ports — one stack, not one per worktree

`cloud/dev/compose/alicorn-local.yml` binds `127.0.0.1` on 5432 / 8081 / 8082 / 8080. Only one
instance can hold them. **Run a single shared stack from the primary worktree** and point every cloud
worktree at it; there is no per-worktree state in it worth isolating. `ALICORN_PG_PORT` exists if you
genuinely need a second, but prefer not to.

---

## 2. The shared spines, measured

Churn is commits in the last 30 days — a proxy for how often you will rebase on it.

| Spine | Churn | Who touches it | Rule |
|---|---|---|---|
| `src/preload/index.ts` | **69** | MB1, RB1, QA1, GP1 | Additive one-liners only. Second to land rebases. Never reorder. |
| `src/preload/api-types.ts` | 34 | same | as above |
| `src/main/startup/main-process-runtime-service.ts` | 14 | MB1, CR1, LG3 | additive registration only |
| `src/main/ipc/register-core-handlers/…` | 9 | MB1, QA1, RB1 | additive registration only |
| `orchestration-schemas.ts` | 4 | GP1, MR1 | additive fields; wire rules apply |
| `src/renderer/src/i18n/locales/*.json` (6 locales) | — | every UI ticket | **Never resolve by hand.** See §5. |
| `cloud/packages/control-plane-contract` | — | GP1, I2, LG4-ctx | Split per domain (`ledger.ts`, `member.ts`, …) so real collisions are rare; the 7-line `index.ts` barrel takes one-line adds. |
| `cloud/apps/*/src/schema-sql.ts` | — | GP1, I2 | append-only statement array; append at the end |
| `cloud/pnpm-lock.yaml` | — | any cloud ticket | **Regenerate, never merge.** See §5. |

Note: L1's ticket says "8 catalogs"; there are **6** (`en, es, fr, ja, ko, zh`). Worth correcting on
the ticket.

---

## 3. Batch 1 — safe to run concurrently, starting now

Every row below has all dependencies Done and owns a distinct concept. Branch names follow
`alc-<sequence-id>-<slug>` from `OWNERSHIP.md`.

| # | Branch | Ticket | Concept owned | Spine risk | Slot |
|---|---|---|---|---|---|
| 1 | `alc-55-gp1-gate-policy` | GP1 | gate evaluation | preload, schema-sql | c1 |
| 2 | `alc-36-i2-keycloak-auth` | I2 | auth mode | contract barrel | c2 |
| 3 | `alc-102-lg4-context-captures` | LG4 | ledger read route | contract barrel | c3 |
| 4 | `alc-101-lg4-wsl-cancel` | LG4 | WSL cancellation | **none** | — |
| 5 | `alc-99-lg3-outbox-retention` | LG3 | outbox retention | runtime-service | — |
| 6 | `alc-86-qa1-context-sandbox` | QA1 | tool-layer path policy | preload, handlers | — |
| 7 | `alc-93-fm5-foreman-waves` | FM5 | wave reduce/serialise | **none** (`.foreman/`) | — |
| 8 | `alc-87-sm1-success-measurement` | SM1 | measurement protocol | **none** (docs) | — |
| 9 | `alc-81-cr1-contract-registry` | CR1 | contract extraction | runtime-service | — |
| 10 | `alc-77-mb1-mailbox` | MB1 | mailbox transport | preload, handlers, **wire** | — |
| 11 | `alc-62-wf2-canvas` | WF2 | workflow canvas | i18n, settings nav | — |
| 12 | `alc-74-rb1-rulebook` | RB1 | rule promotion | i18n, preload | — |
| 13 | `alc-104-ui6-sidebar-collision` | UI6 | **tab surface model** | tabs — sole owner | — |
| 14 | `alc-29-r1-product-identity` | R1 | brand identity | packaging config | — |

**Practical ceiling is lower than 14.** The limiting resource is not worktrees or tokens — it is your
review capacity and the fact that every merge needs a combined-tree run (§5). **Five or six concurrent
is the honest sweet spot**; run 1, 4, 7, 8, 13 first if you want the cheapest possible start, since
three of those touch no shared spine at all. GP1 (#1) should be among the first regardless — nine
tickets and ~19 ew sit behind it.

Rows 4, 7, 8 are genuinely conflict-free and can be handed off with no coordination whatsoever.

---

## 4. Serialization points — do not parallelise these

**a. The tabs spine: UI6 → then MR1 and UI5.**
UI6 decides which of two contradictory surface models survives. MR1 and UI5 both rewrite tab and
workspace-session state. Starting either before UI6 lands means building on the ambiguity that caused
UI6. UI5 additionally waits on R5 per CLAUDE.md.

**b. The rebrand chain: one long-lived worktree, run serially.**
R1 → R2 → {R3, R4} → R5 are strictly sequential by dependency, so they gain nothing from separate
worktrees. Give them **one** worktree and walk the chain.

**c. R4 is stop-the-world — and it goes LAST.**
R4 renames 886 `ORCA_*` env vars across the whole tree. It will conflict with every open branch.

But R4 is a **codemod**, and that changes the calculus: you do not resolve a codemod's conflicts, you
*re-run* it. So the cheap order is to land all feature work first, then run R4 against a quiet tree.
CLAUDE.md's rule — one sweep, never piecemeal, or the CI grep gate lies — is the same instruction.

**This is the one real cost of heavy parallelism**: R5 (the upstream cut, a deadline with a running
meter) sits behind R4, and R4 wants a quiet tree. Running fourteen branches for six weeks pushes the
upstream cut out by six weeks of merge tax. Decide which you are optimising: breadth of feature work,
or an early cut. They trade against each other.

---

## 5. Merge protocol

**Order by radius, and distinguish the two kinds.**

- A branch that changes a **design or invariant** (UI6) lands **first**. N−1 branches then rebase once
  onto it, instead of it absorbing N conflicts — and, more importantly, nobody builds on the wrong model.
- A branch that is a **mechanical sweep** (R4, L1) lands **last** and is *re-run* rather than merged.

**Every merge:**

1. Rebase onto `main`, do not merge `main` in — keeps the history linear and the conflict set small.
2. **Two branches merging on the same day need one combined-tree test run before the second lands.**
   Not two green individual runs. This is exactly the gap that produced UI6, and it is the single
   highest-value rule here.
3. `pnpm tc && pnpm run check:code-quality:changed`, plus `pnpm -r typecheck` from `cloud/` for cloud
   branches — after `pnpm -r build`, since apps import the packages' `dist`.
4. Move the Plane issue to Done on merge.

**Never hand-resolve these two:**

- `src/renderer/src/i18n/locales/*.json` — take either side, then regenerate:
  `node config/scripts/localize-renderer-strings.mjs && pnpm run sync:localization-catalog`.
  `verify:localization-coverage` is the check that matters.
- `cloud/pnpm-lock.yaml` — take either side, then `corepack pnpm install` and commit the result.

---

## 6. Setup

Orca's own worktree UI is the intended path; the equivalent by hand:

```sh
cd /Users/nghiadang/Documents/orca
git worktree add ../orca-wt/alc-55-gp1-gate-policy -b alc-55-gp1-gate-policy main
cd ../orca-wt/alc-55-gp1-gate-policy
pnpm install                      # desktop deps, per worktree
```

Cloud branches additionally need the shim and their own test database — the shim is per-worktree
because `cloud/.pnpm-shim` is gitignored and does not come across:

```sh
corepack enable --install-directory cloud/.pnpm-shim pnpm
export PATH="$PWD/cloud/.pnpm-shim:$PATH"
export ALICORN_TEST_POSTGRES_URL="postgres://postgres:postgres@127.0.0.1:5433/alicorn_test_c1"
cd cloud && pnpm install && pnpm -r build
```

Two costs worth knowing before you open fourteen: each desktop worktree carries its own
`node_modules` (gigabytes, though pnpm's store keeps the download cheap), and the shared local stack
plus test container stay up across all of them.

`git worktree list` to see them; `git worktree remove <path>` when a branch has merged — a stale
worktree holding a merged branch is how you end up re-resolving a conflict you already resolved.

---

## 7. What to do first

1. Reserve the three resources in §1 — one commit to `main` claiming migration numbers, three
   `create database` calls. Ten minutes, and it prevents the two failure modes git will not catch.
2. Open **UI6 alone** and land it. It unblocks the whole tabs lane and it is the known-bad state on
   main today.
3. Open **GP1**, plus the three zero-conflict rows (LG4-wsl, FM5, SM1).
4. Start the rebrand worktree on R1 and walk it serially.
5. Add more from Batch 1 as review capacity allows, keeping ~5–6 in flight.
6. When feature work is quiet, stop the world for R4, then R5.
