# Remaining work — sequencing plan

**Written 2026-09-08.** Baseline: `main` at `850328bde`. Plane project `ALC`, 104 issues, **53 Done,
51 open — all 51 assigned to Nghia Dang.**

This is an *ordering* plan, not a specification. Every module already has an implementation plan in
this directory and those remain the spec for how each ticket is built. What was missing was an answer
to "given one person and 51 tickets, what comes first, and what is actually blocked". That is what
follows.

Ownership changed on 2026-09-08: the two-owner split in [`../OWNERSHIP.md`](../OWNERSHIP.md) no longer
describes reality. Four tickets (LG3, both LG4s, RB1) moved from Huy to Nghia; the other 47 were
already there. **`OWNERSHIP.md` is now stale and should be rewritten or retired** — its "Shared files —
second to land rebases" rule has no second party to coordinate with, and its per-module owner column is
wrong on every row. The *seams* it documents (`alicornFetch`, SQLite v31, client-splits-by-service) are
still correct and worth keeping; only the ownership table is dead.

---

## 0. Blocker zero — the cloud toolchain does not work on this machine

```
$ pnpm --version          → 9.15.0
cloud/package.json        → "packageManager": "pnpm@10.24.0", engines.pnpm ">=10"
$ ls cloud/node_modules   → empty
```

**Fourteen of the 51 open tickets are `Lane: control-plane` or `ledger-api` and cannot be compiled,
tested or reviewed until this is fixed**: I2, I3, I5, LG4-ctx, GP1, GP2, BR1, SK1, PA1, IV1, PV2, OP1,
OP2, and any Postgres test in the others.

This already cost real work. LG4-ctx (`ALC-102`) was written on 2026-09-07 and then **deliberately
reverted** because it could not be verified — the commit message and the ticket both say so. That is the
correct call and it should not have to be made twice.

**Fix first, before any ticket:** enable Corepack (`corepack enable && corepack prepare pnpm@10.24.0
--activate`) or install pnpm 10 alongside, then `pnpm install` in `cloud/`. Confirm with
`pnpm -r typecheck` from `cloud/`. Also bring up the local stack (`pnpm alicorn:up && pnpm alicorn:seed`,
per A9) and export `ALICORN_TEST_POSTGRES_URL`, or every Postgres suite silently *skips* rather than
fails — which reads as green.

This is an environment fix, not a Plane ticket. It is half a day at most and it unblocks 27% of the
backlog.

---

## 1. Three things gate everything else

**a. DS2 — Windows EV certificate. Start today, it is not engineering.**
Priority `urgent`, no dependencies, "0.5 ew **+ weeks of lead time**". Vetting is a calendar cost that
cannot be compressed by working harder later, and ROADMAP §Risks puts it at week 0 for exactly that
reason. Unsigned installers are SmartScreen-blocked, which reads as malware to a buyer. Every day this
is not started is a day added to the end of v0.1. Same argument, smaller, for DS1 (Apple Developer ID
enrolment).

**b. R5 — the upstream cut is a deadline with a running meter.**
CLAUDE.md is explicit: merge upstream greedily *until* the rebrand CI gate goes green, then pin
`UPSTREAM_BASE` and switch to cherry-picks. Upstream ships ~500 PRs between releases. Until R5 lands we
pay merge tax on every one of them; after R5 we stop taking their platform fixes for free. Both sides
are expensive, so the only wrong answer is to sit in the middle for months. R1→R2→{R3,R4}→R5 is
~5.5 ew of mostly mechanical work and should be treated as a single push, not background filler.

It also sequences the interface work: CLAUDE.md says to do the deep tab-model rewrite *after* the
rebrand, so we are not paying merge costs on files we are about to rewrite. UI5 waits on R5.

**c. GP1 — the single biggest unblocker in the backlog.**
`evaluateGate` inside `gateCreate { evaluate }`. Both its dependencies (A8, D5) are Done. It directly
unblocks GP2, GP3 and PV1; transitively BR1, SK1, PA1, PV2, UI3 and AT1. **Nine tickets, ~19 ew, sit
behind one 2 ew ticket.** Nothing else in the backlog has that ratio. It needs blocker zero fixed first.

---

## 2. A circular dependency that has to be broken

- **I5** — relay tokens minted by the Control API — *"Depends on: I2, **BC1**"*
- **BC1** — relay on Alicorn infrastructure — *"Depends on: **I5**"*

These cannot both be true. The real shape is almost certainly three steps, not two:

1. **BC1a** — stand the relay up on our infrastructure in **staging**, still using existing auth.
2. **I5** — Control API mints ES256 relay tokens with the claims `relay-token-verifier` expects; publish JWKS.
3. **BC1b** — point the relay at our JWKS and cut production over.

Decide this before starting either. It blocks BC1, and BC1 is the one Rebrand ticket that reaches
outside its own lane.

---

## 3. Waves

Estimates are the ones authored on the tickets. "Ready" means every dependency is Done today.

### Wave 0 — unblock (days)

| | Ticket | Est | Note |
|---|---|---|---|
| — | **Cloud toolchain + local stack** | 0.5 | Not a ticket. Unblocks 14. Do first. |
| ALC-43 | **DS2** Windows EV cert | 0.5 + lead | Procurement. Start today, run in background. |
| ALC-42 | DS1 Apple Developer ID | 0.75 + lead | Enrolment lead time; pipeline work later. |
| ALC-44 | DS3 Linux glibc floor | 0.5 | Ready, no deps, self-contained CI check. |
| ALC-103 | VI2 dead voice setting | 0.2 | Ready. Delete or wire; smallest ticket in the backlog. |

### Wave 1 — the upstream cut (~9 ew)

`R1 → R2 → {R3, R4} → R5`, with L1, BC2 hanging off R1.

| Ticket | Est | Deps |
|---|---|---|
| R1 product identity | 1 | — (In Progress) |
| R2 CLI `orca`→`alicorn` + shim | 1 | R1 |
| R3 ~600 skill call sites + CI grep gate | 1.5 | R2 (In Progress) |
| R4 `ORCA_*`→`ALICORN_*` (886) + hook reinstall | 1.5 | R2 |
| **R5 record `UPSTREAM_BASE`, stop merging** | 0.5 | R3, R4 |
| L1 localisation, ~800 strings × 8 catalogs | 2.5 | R1 |
| BC2 repoint update feed/telemetry/artifacts | 1 | R1 |

R4 is a whole-tree codemod. Land it when nothing large is in flight, and do it in one sweep — a
piecemeal rename makes the CI grep gate lie (CLAUDE.md says this outright). L1 must land copy changes
before feature copy, per ROADMAP.

### Wave 2 — GP1 fan-out + ledger cleanup (~16 ew, needs Wave 0)

| Ticket | Est | Deps |
|---|---|---|
| LG3 outbox retention | 0.5 | LG1 ✓ |
| LG4 WSL cancellation | 0.5 | LG2 ✓ |
| LG4 context-capture read route | 0.5 | — (was reverted; redo once cloud builds) |
| **GP1 evaluateGate** | 2 | A8 ✓, D5 ✓ |
| GP2 policy RPC + `autonomy_policies` | 1 | GP1 |
| GP3 level-1 advisory | 1 | GP1 |
| PV1 provenance panel | 1 | D6 ✓, GP1 |
| PV2 signed export | 1 | PV1 |
| UI3 run view + Context Inspector | 3.5 | PV1, LG4-ctx |
| BR1 blast-radius budgets | 2 | GP2, C5 ✓ |
| SK1 stable stage keys + level 3 | 3 | WF4 ✓, GP2, CW1 ✓ |

Sequencing rule 2 from ROADMAP applies inside this wave: **the ledger and corrections watcher ship
before any gate retires** — both are Done, so GP3 may run advisory. Nothing here may promote past
level 1 until there is real agreement data. Guard rails ship with the feature: BR1 lands with level 2,
never after.

### Wave 3 — identity → org platform (~16 ew, needs Wave 0)

`I2 → {I3, I4, I5}`; `I3 → OP1 → {OP2, OP3}`; `OP2 → PS1 → SP1`; and BC1 per §2.

| Ticket | Est | Ticket | Est |
|---|---|---|---|
| I2 Keycloak auth mode | 2 | OP1 orgs/invites/seats | 3 |
| I3 identity tables | 1 | OP2 org skill catalog | 2 |
| I4 desktop `readAlicornBearer` | 0.5 | OP3 collaborator seats | 2 |
| I5 relay tokens | 1 | PS1 project-scoped skills | 2 |
| BC1 relay cutover | 1.5 | SP1 skill version pinning | 1 |

### Wave 4 — interface, after R5 (~5 ew)

| Ticket | Est | Deps |
|---|---|---|
| **UI6** sidebar-terminal design collision | ~1 | — (filed 2026-09-08, see below) |
| UI5 session-keyed tab model | 3–5 | UI6, R5, sequenced with MR1 |

**UI6 is new (`ALC-104`).** PR #41 and PR #42 merged 51 minutes apart and both are on main with
contradictory models for a terminal outside the main tab area: `TerminalTab.surface`
(`src/shared/terminal-tab-types.ts:58`, no unified `Tab`) versus `TabGroup.surface`
(`src/shared/tab-types.ts:100`, has a unified `Tab`, filtered at `layoutSpanningGroups`). No visible bug
today, but `tabs-reconciliation.ts` now carries a comment asserting an invariant that is false for the
terminal we ship. Resolve it before UI5 rewrites that area. The full tab/store suites have never run
against the combined tree — each PR was green alone.

UI5's estimate is measured, not guessed: `unifiedTabsByWorktree` appears in 174 non-test files,
`tabsByWorktree` in 962 references. It is a persisted-schema migration, and it should land with MR1,
which is the feature that actually wants session-keyed tabs.

### Wave 5 — parallel, ready today (~36 ew, incl. trailing)

None of these are blocked by anything above. Use them as filler around calendar waits (EV cert, Apple
enrolment) and as the work that continues if a control-plane ticket stalls.

| Ticket | Est | Deps | Then unblocks |
|---|---|---|---|
| QA1 QA context sandbox | 2.5 | D2 ✓ | — |
| WF2 workflow node canvas | 3 | WF1 ✓ | — |
| FM5 wave reduce + serialise deps | 1.5 | FM1 ✓, FM2 ✓ | — |
| SM1 success measurement protocol | 1 | M1 ✓, FM3 ✓ | FM6 |
| RB1 Rulebook | 3 | CW1 ✓, B4 ✓ | RB2 |
| CR1 Contract Registry extraction | 2 | FM1 ✓ | CR2 → IV1 |
| MR1 multi-repo feature workspace | 3 | FM1 ✓ | MR2, UI5 |
| MB1 cross-agent mailbox | 4 | FM3 ✓ | MB2 |

Trailing: RB2 (0.5), CR2 (2), IV1 (2), MR2 (0.5), MB2 (3), FM6 (1), AT1 (4, needs SK1), PA1 (3, needs
BR1 + OP1).

MB1/MB2 are v2.0 and the ROADMAP calls the mailbox "the least certain estimate here; nothing comparable
exists to size it against". Ship single-backend hand-offs first. Do not pull it forward on the strength
of it being unblocked — unblocked is not the same as due.

---

## 4. The capacity problem, stated plainly

Summing the authored estimates across all 50 open work tickets: **~84 engineer-weeks.** One person, no
holidays, is roughly **18 months**. The ROADMAP's critical path assumes 3.5 people (2 full-stack, 1
backend, 0.5 infra) and lands v2.0 around week 39.

The plan above is a correct *order*. It is not a schedule that fits. Three honest options, and this is a
decision for you, not something to resolve by sequencing:

1. **Cut scope to v0.1 + v1.0 and stop.** Waves 0–2 plus Wave 4 ≈ 32 ew ≈ 7.5 months. Delivers the
   instrumented, gated product with the PR body and the provenance panel — the six tier-1 items and the
   thing a stranger appreciates in ten seconds. Drops v1.5/v2.0 (org platform, mailbox, agent-composed
   teams, contract registry) to a later cycle.
2. **Restore a second pair of hands.** Rebrand is the clean split — 11 tickets, one external edge
   (BC1→I5, and §2 has to be resolved anyway), and it collides with feature work only in the i18n
   catalogs. It is the module we analysed as separable today.
3. **Accept 18 months** and set expectations accordingly.

Whichever is chosen, Wave 0 and DS2 are unaffected and should start now.

---

## 5. Working rules for this stretch

- One short-lived branch per Plane issue, `alc-<n>-<slug>`, PR'd into `main`, rebased before merge.
  Move the issue to *In Progress* on start and *Done* on merge.
- **Two PRs merging within the hour need a combined-tree test run, not two green individual runs.**
  That is exactly how UI6 happened.
- Cloud suites need `ALICORN_TEST_POSTGRES_URL`. Without it they skip, they do not fake it — and a skip
  is not a pass. Check the run count, not the colour.
- Renderer strings: write plain English, then `node config/scripts/localize-renderer-strings.mjs &&
  pnpm run sync:localization-catalog`. Never hand-edit a catalog. This collides with L1 — land L1's copy
  changes before new feature copy.
- Do not rename `ORCA_*` piecemeal ahead of R4. A partial rename makes the CI grep gate lie.
- Anything written to the Ledger goes through the outbox. Never `fetch` the Ledger API from a settlement
  path.

---

## 6. Ticket index

**Wave 0 (4 + toolchain)** — DS2, DS1, DS3, VI2
**Wave 1 (7)** — R1, R2, R3, R4, R5, L1, BC2
**Wave 2 (11)** — LG3, LG4-wsl, LG4-ctx, GP1, GP2, GP3, PV1, PV2, UI3, BR1, SK1
**Wave 3 (10)** — I2, I3, I4, I5, BC1, OP1, OP2, OP3, PS1, SP1
**Wave 4 (2)** — UI6, UI5
**Wave 5 (16)** — QA1, WF2, FM5, SM1, RB1, RB2, CR1, CR2, IV1, MR1, MR2, MB1, MB2, FM6, AT1, PA1

50 work tickets. F1 is the Identity epic — a parent, not work of its own — and is the 51st open issue.
