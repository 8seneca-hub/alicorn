# Product architecture — what Orca built, what Alicorn adds, and how they fit

**Written 2026-09-10.** The brief for the prototype of every screen, new and inherited.

Alicorn is a hard fork of an IDE that is becoming an ADE. That is not a reskin: an IDE's primary
object is a _file in a worktree_, an ADE's is _a task worked by members_. Orca shipped 41 settings
panes and 13 right-sidebar panels around the first model. The question this document answers is
what happens to them — because "delete it and start again" throws away the platform work that is
genuinely expensive (Windows EDR posture, WSL argv, SSH boundaries, Git version floors) and
"keep it all" produces two products in one window.

---

## 1. They are not competing. They are at different altitudes.

The inherited surfaces and the new ones never fought for the same job. Sorting them by _what
question they answer_ makes the conflict disappear:

| Altitude    | The question                                       | Where it came from     |
| ----------- | -------------------------------------------------- | ---------------------- |
| **Direct**  | What work, by whom, under what rules?              | New — Alicorn          |
| **Execute** | What is actually happening on a machine right now? | Orca, nearly all of it |
| **Operate** | How is this machine and this account set up?       | Orca, nearly all of it |

Read that way, **all 13 right-sidebar tabs are Execute** — explorer, search, vault, workspaces,
pr-checks, source-control, checks, ports, run, terminal, provenance, context, gates. Every one of
them is a thing you want open _while work is happening_. They do not belong to an org or a project,
which is exactly why they never fitted the org→project split. They belong to a **task**.

That single observation resolves most of the inheritance problem. The Orca panels are not legacy to
be migrated; they are the Execute altitude, already built, and they attach to the new primary
object without being rewritten.

---

## 2. The object model

```
Org ─────────── the library. Members, workflows, autonomy defaults,
 │              required checks, skills. Nothing runs here.
 │
 ├─ Project ─── an instance of the library, with overrides.
 │   │          Repos, integrations, board columns, runtime environments.
 │   │
 │   └─ Task ── THE UNIT OF WORK. Replaces the worktree as the thing
 │       │      you open, name, assign and finish.
 │       │
 │       ├─ Session ──── members conversing and handing off until done
 │       ├─ Workspaces ─ 0..N (repo, branch, worktree) tuples
 │       └─ Panels ───── the 13 inherited right-sidebar tabs
 │
 └─ Stage ────── where rules and autonomy actually bind. A stage of a
                 workflow, overridable per project.

Device ───────── appearance, terminal, shortcuts, input, notifications.
Account ──────── agent backends and their credentials.
                 Neither is org-scoped or project-scoped; both follow
                 the person and the machine.
```

**Why a task and not a worktree.** A worktree is one thing a task might need. `alicorn_task_worktrees`
already binds N `(repo, branch, worktree)` tuples per task (`SCHEMA_VERSION` 39), and MR2's escalation
signal reads `countTaskRepos(taskId) > 1`. The data model went task-first; the UI did not follow. A
two-repo feature is one task and would have been two unrelated sidebar rows.

**This forces UI5.** CLAUDE.md already says "a tab is a session, not a workspace", and records that
the user-visible half shipped while the re-keying did not. This architecture is the reason the
re-keying matters: if the task is the unit, a tab has to be a task session, or the tab strip and the
object model disagree in front of the user.

---

## 3. The two surfaces that cut across every altitude

The altitudes are for _inspecting_. Two surfaces are always present and belong to no altitude:

### Converse — the input

Chat and voice are not a destination. v1's prototype had **Voice** as a rail button, which is the
same category error as making **Team** a rail button: you do not _go to_ voice, you speak. It is
omnipresent, and it routes by intent, not by where you are standing:

- "add a QA member on Gemini, read-only, joins at verify" → Direct
- "run the payment tests in this worktree" → Execute
- "make the terminal font bigger" → Operate

**Every mutation returns a receipt.** What changed, and undo. Without that, conversational
configuration is unauditable — and this product's entire claim is that the record is the asset.

### Decide — the return channel

**An agent's proposal and a human gate are the same object.** Both are: an agent needs a decision,
here is the context, here are the options, here is what I would do. A merge gate and "shall I split
this into five tasks across Dev, Architect and QA?" differ only in payload.

So there is one inbox, not a gates queue plus a suggestions feed. It is the north-star metric's
denominator made visible: everything in it is an interruption, and
`interruptions_per_completed_task` is literally its length over time.

---

## 4. Agent-initiated decomposition is already in the model

The requested behaviour — a big task arrives, an agent proposes breaking it down and assigning
members — is `execution_strategy: orchestrated`, which exists:

- `execution_strategy` is a field on a task, `single` | `orchestrated`, and **`single` is the default
  and stays the default**.
- **"Escalation is per task and is offered, never applied silently."** When a session crosses the
  300k context ceiling or turns out to touch more than one repo, Alicorn _offers_ the switch and
  **records whether the offer was accepted**.

So the missing piece is not the mechanism. It is a UI that can render _an offer_ — and by §3 that
is an inbox card, the same shape as a gate.

The Foreman layer is what runs a decomposed task: a lead that writes no code and reads no
implementation, schema-bounded returns with a hard token ceiling, state on disk in the Feature
Journal so a run survives the session that started it.

---

## 5. The boundary that makes chat-driven configuration safe

If agents can reconfigure by conversation, an agent can weaken the gate that judges it. The codebase
already forbids this: **"a member cannot loosen its own criteria — required checks are authored on
the stage, not by the member being judged."**

So agent-initiated change splits in two, and the split is not stylistic:

| Agents may apply directly (with a receipt)   | Agents may only propose                   |
| -------------------------------------------- | ----------------------------------------- |
| Create a task, split a task, assign a member | Required checks on a stage                |
| Draft a workflow, add a stage                | Autonomy level                            |
| Open a workspace, run a command              | Hard stops, reversibility, inherited cost |
| Write a summary, post a PR body              | Anything judging the proposing member     |

The right-hand column is the trust boundary. It is also where the existing invariants live:
**hard stops never retire** regardless of track record, and `reversibility` / `inherited_cost` are
authored on a stage, never inferred, because guessing wrong once is a production deploy.

---

## 6. Where the 41 inherited panes land

Nothing is deleted. Each pane gets exactly one home, which is the test the current single-sidebar
design fails.

**Direct — org (7).** AlicornMembers, AlicornWorkflows, Orchestration, autonomy, required checks,
skills, ShareSkills.

**Direct — project (9).** Repository, Git, GitProviderApiBudget, BoardAutomation, Integrations,
RuntimeEnvironments, Ssh, EphemeralVms, Tasks.

**Operate — device (13).** Appearance, Terminal, Input, Shortcuts, Notifications, DevTools,
Experimental, Privacy, Voice, Browser, BrowserUse, ComputerUse, FloatingWorkspace.

**Operate — account (6).** Accounts, OrcaAccountSettings, Agents, LinearAgentSkill,
ArtifactsSettings, AutomationsSettings.

**Execute — task panels (13 tabs).** explorer, search, vault, workspaces, pr-checks, source-control,
checks, ports, run, terminal, provenance, context, gates.

**Mobile / emulator (4)** and the setup guide sit outside this frame and stay where they are.

The remainder are general/advanced and belong to a flat Settings root.

---

## 7. Navigation, restated

- **Rail** — scope switcher only: projects, then Org, then Settings. It stops being a menu of
  screens, because conversation replaces most navigation.
- **Sidebar** — a _function of_ the rail selection. This is the v1 bug: one static `<aside>`
  served all fifteen screens and read "Payments Platform · 14 open" while you edited org-wide
  autonomy.
- **Main** — the inspector for the selected scope.
- **Right sidebar** — the task's own panels, unchanged from Orca, now correctly attached.
- **Command bar** — omnipresent, over everything.
- **Inbox** — one queue, reachable from every scope, showing gates and proposals together.

---

## 8. What this deliberately does not do

- **No third level of override.** Org → project is two levels and explainable. A per-task override
  of a stage rule would be a configuration nobody can reason about.
- **No colour for anything but attention.** One hue means "a human is required". Everything else
  carries meaning by shape and text, which the accessibility pass required anyway.
- **No agent authority over its own judgment.** §5.
- **`single` stays the default.** Multi-agent is a trade — roughly an order of magnitude more
  tokens — not an upgrade, and anything that makes `orchestrated` the default path is wrong.

---

## 9. Open questions, to settle before building

1. **Do projects own members, or only bindings to org members?** Drawn as the library owning them.
   Per-project copies are simpler to build and much worse at three projects, because a backend swap
   becomes N edits.
2. **One inbox or per-project inboxes?** Both are drawn. If the cross-project one is what gets used,
   the per-project one is dead weight.
3. **Does the command bar need a visible mode?** Routing by intent is invisible when it works and
   confusing when it misses. A "this went to Direct" receipt may be enough.
4. **How much of Execute does a non-engineer ever see?** Collaborator seats are in the roadmap; a PM
   who never opens a terminal still needs the task session and the inbox.
