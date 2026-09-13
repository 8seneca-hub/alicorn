# Alicorn — Roadmap

Four releases. Each one is demonstrable on its own; no release exists only to enable the next.
Estimates are engineer-weeks for a team of **3–4** already fluent in the codebase, with the existing
quality gates left on.

---

## v0.1 — Instrument

**Weeks 0–9 · nothing is automated yet; you start measuring**

| Workstream              | Scope                                                                                                                                                                                                                                                                                                                          | Weeks           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Rebrand                 | App id, product name, protocol scheme, icons, wordmark. Rename the CLI to `alicorn` and rewrite ~600 call sites across the bundled skill corpus, with a CI gate that fails on any surviving `orca ` invocation. Rename `ORCA_*` → `ALICORN_*` (886 vars) with a versioned hook reinstall across local, WSL and every SSH host. | 4–6             |
| Localisation            | ~800 branded strings across 8 catalogs. Re-translate reworded keys — key-parity checks do not catch stale translations.                                                                                                                                                                                                        | 2–3             |
| Identity                | Keycloak 26+ deployed; Control API with org→policy mapping, `user_id` mapping, relay tokens. Desktop repointed.                                                                                                                                                                                                                | 4–6             |
| Backend cutover         | Relay, update feed, telemetry, artifacts, plugin kill-list, feedback onto own infrastructure.                                                                                                                                                                                                                                  | 2–3             |
| Distribution            | Apple Developer ID + notarisation; **Windows EV certificate — start week 0**, vetting takes weeks. Linux glibc 2.31 floor.                                                                                                                                                                                                     | 1–2 + lead time |
| **Members**             | The Member entity: role, backend, skills, permission mode, workspace kind, system rules. Member library and editor.                                                                                                                                                                                                            | 3–5             |
| **Ledger**              | `step_outcomes`, `step_verifications`, `member_stage_stats`. Written from existing `worker_done` (`outcome`, `files-modified`, `phase`). Idempotency keys, server-assigned time, offline queue. **Observe-only: every gate still fires.**                                                                                      | 2–3             |
| **Corrections watcher** | Follow-up commits to the same files, reverts, reopened tasks → `human_verdict = 'amended'`.                                                                                                                                                                                                                                    | 2               |

**Exit criteria**

- A developer can create a Member and run a task through it end to end.
- The ledger records every step with zero duplicates under induced retries.
- `interruptions_per_completed_task` is reportable, per stage, for your team and three design partners.

**Kill signal** — interruption counts are already low. The premise has no headroom; stop and re-scope.

---

## v1.0 — Remove the babysitting

**Weeks 8–19 · the first sellable release**

| Workstream               | Scope                                                                                                                                                                                               | Weeks |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Board automation**     | Rule engine binding column transitions to member dispatch, through the existing task-create/dispatch path so runs carry provenance. Loop detection, per-task dispatch ceiling, visible kill switch. | 4–6   |
| **Plane provider**       | Fifth provider in the `TaskProvider` registry. Size against Jira (~3.1k lines), not Linear. Two-way sync reuses the existing drag-to-status write-back.                                             | 4–6   |
| **Gate policy**          | `evaluateGate`, `gateCreate{evaluate}`, `policySet`/`policyGet`/`evidence`. Levels 0–1.                                                                                                             | 3–4   |
| **Blast-radius budgets** | Files, spend and protected paths, budgeted **per run**. Enables Level 2.                                                                                                                            | 2–3   |
| **Provenance panel**     | "Why no human was asked" — checks, reversibility, blast radius, track record, policy. Exportable.                                                                                                   | 2     |

**Exit criteria**

- Drag a card to In Review; the reviewer picks it up, returns findings to the author, and it completes with no human. The merge gate then stops and asks.
- Interruptions per completed task measurably down against the v0.1 baseline, from your own ledger.
- Price tested at $69/seat.

---

## v1.5 — Remove the hand-off

**Weeks 17–27 · where the platform story becomes true**

| Workstream                      | Scope                                                                                                                                                                                                                                                                                               | Weeks |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Authored workflows + canvas** | Stages, owners, triggers as a saved object. Node canvas with the return edge as a first-class concept. Stages bind to board columns — one model, two views.                                                                                                                                         | 6–8   |
| **Stable stage keys**           | Keys from workflow templates, not free-text `phase`. Level 3, automatic retirement and demotion. **Shipped 2026-09-08 (SK1)** — the machinery is complete and inert: nothing retires below 50 runs, an uncorrected record caps at level 1, and hard stops never retire. See ARCHITECTURE §3 and §7. | 3     |
| **Voice intent**                | Route transcripts to an agent holding the CLI skill rather than writing a parser. Confirm before anything destructive. On-device transcription stays the default.                                                                                                                                   | 3–4   |
| **Org platform**                | Orgs, invites, roles, seats. Org skill catalog with stage-authored required checks. Collaborator seats for PM, BA and design in folder workspaces.                                                                                                                                                  | 5–8   |

**Exit criteria**

- Researcher → PRD → tech lead runs as one chain with no human relay between stages.
- A gate retires on its own after evidence accrues, and returns on its own after a rejection.
- First non-engineering seats active in a real account.

---

## v2.0 — Agents author the workflow

**Weeks 25–39 · the end state**

| Workstream               | Scope                                                                                                                                                                                                                                      | Weeks |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **Cross-agent mailbox**  | Backend-neutral addressing, delivery and acknowledgement so a Grok analyst can hand to a Claude developer. Capability-negotiated stream opcodes — decoders drop unknown opcodes silently. Keep the existing native path working alongside. | 8–12  |
| **Agent-composed teams** | A goal in; the system selects specialists, composes the team and runs the chain.                                                                                                                                                           | 6–8   |
| **Policy at scale**      | Cross-project orchestration, org-wide budgets, standing-exception review.                                                                                                                                                                  | 3     |

**Exit criteria**

- A raw idea produces a spec, an architecture proposal at a gate, and a merged change — with three human touchpoints.

**Dependency worth stating plainly:** an agent can only author a workflow once there is a history of
workflows that worked. That history is what v0.1–v1.5 accumulate. It cannot be pulled forward.

---

## Critical path

```
wk 0    ├─ EV certificate + Apple enrolment          ← longest lead item, not engineering
wk 0-6  ├─ Rebrand ─────────────┐
wk 0-6  ├─ Keycloak + Control API │  parallel tracks
wk 2-7  ├─ Members ──────────────┘
wk 4-9  ├─ Ledger + corrections watcher   ← gates everything in v1.0
wk 8-19 ├─ Board automation · Plane · gate policy · budgets
wk17-27 ├─ Workflows · voice · org platform
wk25-39 └─ Mailbox · agent-composed teams
```

The rebrand and the product work are largely independent — the rebrand is configuration and copy, the
product work is application code. They collide only in the localisation catalogs, so land copy changes
before feature copy.

---

## Sequencing rules

1. **Autonomy is unlocked by evidence, and evidence only accumulates by running gated.** Any attempt to
   ship v2.0 behaviour earlier means an agent composing a team with no track record to reason about.
2. **The ledger and the corrections watcher ship before any gate retires.** Run observe-only for a few
   weeks and compare what the policy _would_ have decided against what humans actually did. Learn the
   disagreements for free rather than in a customer's repository.
3. **Guard rails ship with the feature that needs them**, never after. Loop detection lands with board
   automation; blast-radius budgets land with Level 2.
4. **Wire changes are additive or capability-negotiated.** No exceptions — the failure is silent.
5. **Keep Control API to three jobs**: org→policy, relay tokens, member and workflow configuration.
   Billing, provisioning and audit tooling each get their own home or the schedule slips.

---

## Risks

| Risk                                                                                                                                                    | Response                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows EV certificate lead time**                                                                                                                    | Start week 0. Unsigned installers are SmartScreen-blocked, which reads as malware to a buyer.                                                              |
| **Silent quality drift** — humans fix agent output without rejecting a gate, so accept rate rises while quality falls                                   | The corrections watcher. Until it ships, advisory mode only.                                                                                               |
| **Stale hooks after the env rename** — hook scripts live in user-owned config and on remote SSH and WSL hosts, and a missing variable is a silent no-op | Versioned hooks, forced reinstall across every host, and a startup check that reports hosts it could not reach rather than assuming success.               |
| **Missed CLI call site** — ~600 invocations that agents execute at runtime                                                                              | CI grep gate over the whole skill corpus; a surviving bare `orca ` fails the build.                                                                        |
| **Silent wire breakage**                                                                                                                                | Capability-negotiate every new stream opcode.                                                                                                              |
| **Automation runaway** — board rules that dispatch agents can loop, and each loop costs real tokens                                                     | Per-run dispatch ceiling, loop detection, kill switch, shipped with the rule engine.                                                                       |
| **Cross-agent mailbox overruns**                                                                                                                        | The least certain estimate here; nothing comparable exists to size it against. Ship single-backend hand-offs first and treat cross-backend as a follow-on. |
| **Over-engineering the control plane**                                                                                                                  | 1.2M ledger rows a year does not need Kafka. Every hour there is an hour not spent on the corrections watcher.                                             |

---

## Team

| Role                       | Count | Focus                                        |
| -------------------------- | ----- | -------------------------------------------- |
| Full-stack (desktop)       | 2     | Members, board automation, workflows, canvas |
| Backend / platform         | 1     | Keycloak, Control API, Ledger, migrations    |
| Infrastructure (part-time) | 0.5   | Terraform, Helm, CI/CD, observability        |
| Design (part-time)         | 0.5   | Screens, design system, landing              |

Roughly **4 FTE for nine months** to v1.5. v2.0 needs one additional backend engineer for the mailbox.
