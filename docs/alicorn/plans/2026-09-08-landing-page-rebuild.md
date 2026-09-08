# Landing page rebuild — the whole product, not just the new half

**Written 2026-09-08.** Site: `site/` (static HTML, `build.mjs` assembles `pages/*.html` into
`layout.html`; no framework, no dependencies). Baseline: main at `4bd59c457`.

---

## The problem, measured

`rg -ci "orca" site/pages/*.html` returns **zero**. Across all seven pages, the product the visitor
would actually install is never named or described.

The site sells the Alicorn control layer — Members, Workflows, gates, the decision trail — and sells it
well. But that layer is an *addition to* a desktop IDE, and the IDE is invisible. The whole of what
`docs/site/content/docs/index.mdx` calls the product ("a desktop IDE for running multiple AI coding
agents side by side… every task gets its own git worktree, its own agent terminal, its own browser
tab") appears as five incidental words across two pages.

Three consequences, in order of cost:

1. **The site describes a SaaS, and the product is a desktop app.** "You bring the agents. We hold the
   process." reads as hosted infrastructure. A visitor arrives at `Start free` expecting a signup and
   meets an installer. That is a conversion problem and a trust problem at the same time.
2. **The strongest proof is missing.** Fifteen documented capability areas — parallel worktrees, SSH
   hosts, remote servers, mobile, terminal, notifications, cloud VMs — are the evidence that this is a
   real tool rather than a slide. Omitting them makes the gate-and-ledger story sound theoretical.
3. **The new work reads as the whole product**, so it has to carry weight it cannot. Autonomy policy is
   compelling *because* it sits on something that already runs agents on your machine, over SSH, in
   parallel. Without the base, it is a governance layer over nothing.

**What is not wrong:** the Alicorn copy itself. "Stop babysitting", the three-gates-in-eight-steps
pipeline, the interruptions counter, the decision trail — that material is good and should survive the
rebuild almost unchanged. This is an addition and a reframe, not a rewrite of what exists.

---

## The frame: one product, two layers

> **The IDE runs your agents. The control plane decides when to ask you.**

Everything on the site should resolve to one of those two clauses, and the page should make the
relationship obvious: the second is worthless without the first, and the first is what most visitors
already need today.

Naming, per CLAUDE.md's rebrand posture: the product is **Alicorn**. Orca is the upstream it forks, and
that is a fact for the docs and the `NOTICE`, not a brand on the marketing site. So the base
capabilities are described as **Alicorn's**, because they are — we own the core. Do not introduce "Orca"
as a second product name in marketing copy; describe the capabilities, not the lineage.

---

## Page plan

### `index.html` — restructured, not replaced

| Order | Section | Status |
|---|---|---|
| 1 | Hero — "Stop babysitting" | **Keep.** Add one sub-line naming the desktop app, so the category lands in the first screen. |
| 2 | **The IDE — parallel agents, real worktrees** | **NEW.** The missing half. Three to four capability tiles, below. |
| 3 | "Your agents got fast. Your team got slower." | Keep. |
| 4 | "Set it up once. Then get out of the way." | Keep — this is where the control layer enters, and it now has a foundation to sit on. |
| 5 | Build your team / Draw the process / Approve what matters | Keep. |
| 6 | Three gates in eight steps | Keep. |
| 7 | Every step leaves a trail | Keep. |
| 8 | "Everything that makes autonomy defensible" | Keep, extend with what shipped since (below). |
| 9 | **Runs where you do** | **NEW.** Desktop, SSH, self-hosted server, cloud VM, mobile. |
| 10 | Interruptions counter + CTA | Keep. Fix the CTA expectation — see *Start free*. |

### Section 2 — the IDE tiles

Each is documented, so each is checkable rather than aspirational:

- **Parallel worktrees.** Three agents on the same bug, each in a real git worktree. `cd` in and use
  plain git whenever you want. (`docs/index`, `first-session`)
- **Any agent you already pay for.** Claude Code, Codex, Cursor CLI, OpenCode — bring your own
  subscription. We never hold a model key. (`docs/index`, and it is an architecture invariant)
- **A terminal per task.** Agent terminal, browser tab and worktree per task, no stashing or
  branch-juggling. (`docs/terminal`)
- **Review the diff before it ships.** The base assumption is that you read diffs. (`docs/index`)

### Section 9 — runs where you do

Desktop by default; **SSH targets**, **self-hosted servers**, **cloud VMs / per-workspace
environments**, and **mobile** for watching a run from your phone. Each maps to a docs page
(`ssh`, `remote-servers`, `ways-to-run`, `mobile`, `android-apk`), so every claim is one click from its
proof. Self-hosted is already a tile in section 8 — move it here, where it reads as deployment rather
than as a governance feature.

### Section 8 — what to add

Shipped since the copy was written and worth naming:

- **Blast-radius budgets** (already listed) — now real: per-run file, spend and protected-path budgets
  that decomposition cannot launder past.
- **A signed decision trail.** PV2 ships an ES256-signed, dated export — an auditor verifies it against
  published JWKS rather than taking a screenshot.
- **Advisory gates that measure themselves.** GP3 records whether the human agreed with what the policy
  would have decided, which is what earns the right to retire a gate later.
- **QA that cannot read the implementation.** Enforced at the tool boundary, not asked for in a prompt.
  State the guarantee exactly as ARCHITECTURE §9 does — "cannot open implementation with its file tools
  or name it in a shell command" — never "cannot see implementation". The stronger claim is false.

### `product.html` — "Four objects" becomes five

It currently opens "Four objects. That's the whole product." That is now inaccurate in a way a careful
reader will catch: the workspace — worktree, terminal, agent session — is a fifth object and the one
you touch first. Add it as the *first* object, before Member.

### `start.html` — set the right expectation

Whatever it says, the first step is an install, not a signup. Check and fix; a `Start free` that implies
a hosted trial is the single most likely place to lose a visitor who would otherwise have converted.

---

## Non-goals

- No redesign. `assets/system.css` and `site.css` stay as they are; this is content and structure.
- No new dependency. The site is deliberately zero-dependency static HTML — keep it that way.
- No unshipped claims. Everything on the page must be either shipped on main or documented. Workflows
  and the canvas (WF2) are in flight; do not promise the canvas until it lands.
- No "Orca" as a marketing brand. Attribution lives in `NOTICE` and the docs.

## Verify

`pnpm --dir site check` — builds and verifies every internal link and anchor resolves. Every docs link
added by this work must resolve, and that check is what proves it.
