# Foreman Core Implementation Plan (v1.5) — with v2.0 notes for AT1, MR2, SM1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Caveat (v1.5/v2.0):** this plan builds on D1/D2/D4 (execution strategy, member launch, context-ceiling watcher) and D7 (run cost) from the tier-1 desktop plan. Re-verify every file:line anchor against the codebase when picking a task up; the structure and interfaces are the commitment, the line numbers are not.

**Goal:** Make `execution_strategy: orchestrated` real: a lead that plans, dispatches bounded subagents and re-plans — writing no code and reading no implementation — with the run's truth on disk (Feature Journal) so a run survives the session that started it; typed reports with a hard ceiling enforced at the tool boundary; a run view with a live cost meter.

**Architecture:** Foreman is **Orca's existing `Coordinator` under stricter rules**, not a new engine (research §1). A task with `execution_strategy = orchestrated` is run by a lead dispatch whose launch options deny code-editing tools and whose worker dispatches must report through a schema-bounded `worker_done` body (≤ 6 000 chars ≈ 1 500 tokens; overflow spills to `.foreman/<run>/<dispatch>-report.md` and `--report-path`). The Feature Journal (`.foreman/<run-id>/journal.md`) is written by the coordinator on every lifecycle event and is what a resumed lead reads. The `/foreman` slash command stays a developer prototype; its templates are the seed for the journal and report schemas.

**Tech Stack:** `src/main/runtime/orchestration/coordinator*.ts`, `preamble.ts`, `lifecycle-reconciliation.ts`, CLI `message-send-handler.ts`, Claude Agent SDK launch options (`disallowedTools`) + a deny-capable `PreToolUse` hook, `contextTokensFromTranscriptTail` (D4), renderer run view, vitest.

**Spec:** `CLAUDE.md` → *Foreman is an add-on* (three stricter rules), *Execution: two axes*; `docs/alicorn/PROJECT-BRIEF.md` §05 (context boundary, report fields, lead ceiling, Journal), §11.7 (success measurement); `.claude/commands/foreman.md` + `docs/alicorn/foreman-templates.md` (prototype); `docs/alicorn/GRAPH-ENGINEERING.md` (reduce node, fake-edge test, executor spike); research `research/foreman-rulebook.md`. Plane: FM1–FM6, AT1, MR2, SM1 (module *Execution strategy & Foreman*, owner Nghia).

## Global Constraints

- **Foreman is an add-on**: every change keeps `single` tasks working with no journal, no report schema and no tool restrictions in their path.
- **The lead writes no code and reads no implementation — enforced, not advised**: `disallowedTools` at launch **and** a deny-capable `PreToolUse` hook for Claude Code (the same primitive QA1 needs; built once here). Backends without an equivalent cannot run a lead: `worker-start --role lead` on them fails with `lead_backend_unsupported`.
- **Reports are schema-bounded with a hard ceiling; overflow → file + path**: enforced at the CLI boundary and again server-side for the federated path.
- **State is on disk**: the journal is the source of truth for a resumed run; SQLite has tasks/dispatches, the journal has decisions/assumptions/contract deltas.
- **≤ 40 % of the model window** for the lead: measured from the transcript tail; at the ceiling the lead is told to compact into the journal (`PostCompact` already registered).
- Cost is shown, not summed silently: unknown spend renders as partial.
- No `helpers`/`utils` names; additive RPC/CLI changes; i18n by tooling; no AI attribution.

## Decisions made in this plan

1. **Foreman = Coordinator** (research §10.7): the product's lead is a coordinator-role dispatch over Orca's orchestration RPC; the `/foreman` command remains a dev prototype and is not what ships.
2. **Token ceiling by chars/4**: `FOREMAN_REPORT_MAX_TOKENS = 1500`, `FOREMAN_REPORT_MAX_CHARS = 6000`; no tokenizer dependency. Overflow is never truncated — it is written to a report file and the body becomes the schema's required fields only.
3. **Report schema is JSON** (not YAML) in the `worker_done --body`: `{ status, summary, changes[], interface_delta[], verification, open_questions[], cost }` validated by `ForemanReportSchema` (zod). Legacy free-text bodies remain valid for `single` runs; orchestrated runs require the schema.
4. **Lead restriction = `disallowedTools: ['Edit','Write','MultiEdit','NotebookEdit']` + PreToolUse deny for Read/Grep/Glob under the worktree's source paths** except the journal and report files. The deny hook is Orca-managed (`src/main/claude/hook-settings.ts` gains a `PreToolUse` deny command for panes flagged `role: lead`).
5. **Journal path** `.foreman/<run-id>/journal.md` inside the run's primary worktree (gitignored — already in `.gitignore`), sections from `foreman-templates.md` (Status/Budget, Objective, Decisions, Assumptions, Plan, Contract registry stub, Log, Not done).
6. **Model window table** for the 40 % rule: `{ 'claude-*': 200_000 | 1_000_000 per model id prefix }` in `src/shared/alicorn/model-windows.ts`; unknown model → assume 200 000.
7. **AT1/MR2/SM1**: AT1 is planned as a design + thin implementation (team composition from member roles, gated by the human), MR2 as a signal added to D4's watcher once MR1 exists, SM1 as a protocol document + a CLI report over the ledger.
8. **Reduce before synthesize (FM5, `docs/alicorn/GRAPH-ENGINEERING.md`)**: the lead never reads N raw reports. When every node of a wave has reported, a code step merges the bounded reports into one table (status, summary, files, open questions, cost) written to `.foreman/<run>/wave-<n>.md`; the lead is prompted with that path. The same step flags any file touched by two workers in the wave (false independence).
9. **Fake-edge test at dispatch (FM5)**: plan nodes may declare `files[]`; nodes in the same wave whose declared files overlap are serialised (the later one waits) and the overlap is journaled. Undeclared files are checked after the fact by the reduce step only.
10. **Claude Code's `workflow` feature is a candidate executor, not the engine (FM6)**: a spike exports a Feature Journal plan as a Claude Code workflow script and runs one ticket both ways under SM1's protocol. The coordinator stays the backend-neutral shell either way.

## File structure

```
src/shared/alicorn/foreman-report.ts                 ForemanReportSchema, FOREMAN_REPORT_MAX_CHARS/TOKENS, fitReportBody()
src/shared/alicorn/model-windows.ts
src/cli/handlers/orchestration/worker-done-report-ceiling.ts    CLI-boundary enforcement + spill
src/main/runtime/orchestration/lifecycle-reconciliation.ts      server-side rejection `body_too_large`
src/main/alicorn/foreman/journal.ts                  parse/write journal sections
src/main/alicorn/foreman/journal-writer.ts           lifecycle → journal Log/Plan updates
src/main/runtime/orchestration/coordinator-foreman-journal.ts   coordinator sibling wiring
src/main/alicorn/foreman/lead-launch-options.ts      disallowedTools per backend, lead_backend_unsupported
src/main/claude/hook-settings.ts                      PreToolUse deny command for lead panes
src/main/alicorn/foreman/lead-context-ceiling.ts     40 % rule over contextTokensFromTranscriptTail
src/main/alicorn/foreman/lead-compaction-prompt.ts
src/renderer/src/components/right-sidebar/run-view/**   RunView (journal nodes + cost)
src/main/alicorn/foreman/reduce-reports.ts            FM5: merge a wave's bounded reports into one table; file-overlap flags
src/main/alicorn/foreman/wave-dependency-check.ts     FM5: serialise nodes whose declared files overlap
src/main/alicorn/foreman/export-claude-workflow.ts    FM6 spike: Feature Journal plan → Claude Code workflow script
docs/alicorn/FOREMAN.md                               product spec of the lead; SM1 protocol
```

---

### Task 1 (FM2): Report schema and CLI-boundary ceiling

**Files:** `src/shared/alicorn/foreman-report.ts` (+ test), `src/cli/handlers/orchestration/worker-done-report-ceiling.ts` (+ test), modify `message-send-handler.ts` / `message-payload.ts`.
```ts
export const FOREMAN_REPORT_MAX_TOKENS = 1500
export const FOREMAN_REPORT_MAX_CHARS = FOREMAN_REPORT_MAX_TOKENS * 4
export const ForemanReportSchema = z.object({
  status: z.enum(['done', 'blocked', 'needs_decision', 'failed']),
  summary: z.string().min(1).max(600),                         // ≤ 3 sentences (checked: ≤ 3 '.'/'!'/'?' terminators)
  changes: z.array(z.object({ repo: z.string().optional(), path: z.string(), kind: z.enum(['added','modified','deleted','renamed']), why: z.string().max(200) })).max(200),
  interface_delta: z.array(z.object({ kind: z.string(), name: z.string(), shape: z.string().max(500), breaking: z.boolean() })).max(50),
  verification: z.object({ command: z.string().max(500), result: z.enum(['passed','failed','not_run']), evidence: z.string().max(500) }),
  open_questions: z.array(z.string().max(300)).max(20),
  artifacts: z.array(z.string()).max(50).default([]),
  cost: z.object({ tokens_in: z.number().int().nonnegative().nullable(), tokens_out: z.number().int().nonnegative().nullable() })
})
export type FitResult = { body: string; spilled: boolean; reportPath?: string }
export function fitReportBody(body: string, opts: { writeSpill: (content: string) => string /* returns path */; maxChars?: number }): FitResult
// ≤ max → unchanged; > max → writeSpill(full body) → body = JSON of the parsed report with `summary`, `status`, `verification`, `cost` kept and `changes`/`interface_delta`/`open_questions` truncated to the first N entries + `artifacts: [reportPath]`
```
CLI (`orchestration send --type worker_done`): if the run's strategy is orchestrated (`--orchestrated` flag injected by the preamble, or detected from `ORCA_ALICORN_STRATEGY` env stamped at dispatch), parse `--body` with `ForemanReportSchema` (400-style `RuntimeClientError('invalid_report', issues)`), then `fitReportBody` (spill to `.foreman/<run>/<dispatch>-report.md`); with `--report-path` already given and body over the limit → error `report_ambiguous`.
- [ ] Tests: schema accepts the template report and rejects a 4-sentence summary; fit spills > 6000 chars and sets `artifacts`; handler rejects invalid reports for orchestrated runs and passes free text for single runs. Commit `feat(foreman): bounded worker reports — schema, ceiling and overflow spill at the CLI boundary`.

---

### Task 2 (FM2): Server-side defence in depth

**Files:** `lifecycle-reconciliation.ts` (+ test), `federation-worker-report-payload.ts`, `orchestration-schemas.ts` (`SendParams.body` `.max(FOREMAN_REPORT_MAX_CHARS * 4)` as an absolute sanity cap for all runs).
- [ ] `worker_done` with body > cap on an orchestrated task → `{ action: 'rejected', code: 'body_too_large' }`; single runs unaffected below the absolute cap. Commit `feat(orchestration): reject oversized worker reports server-side`.

---

### Task 3 (FM1): Journal format and primitives

**Files:** `src/main/alicorn/foreman/journal.ts` (+ round-trip test).
```ts
export type JournalNode = { id: string; title: string; owner: string; dependsOn: string[]; status: 'pending' | 'dispatched' | 'done' | 'failed' | 'blocked'; model: string | null; dispatchId: string | null }
export type Journal = { runId: string; objective: string; status: 'running' | 'paused' | 'done' | 'failed'; startedAt: string; budgetCents: number | null; spentCents: number | null; decisions: Array<{ n: number; decision: string; chosen: string; why: string; reversible: boolean }>; assumptions: Array<{ n: number; assumption: string; blastRadius: string; dependents: string[] }>; plan: JournalNode[]; contractRegistry: string; log: Array<{ at: string; line: string }>; notDone: string[] }
export function renderJournal(j: Journal): string; export function parseJournal(md: string): Journal   // sections/tables exactly as foreman-templates.md; parse errors → JournalParseError with the section name
export function journalPath(worktreePath: string, runId: string): string   // .foreman/<runId>/journal.md
export async function readJournal(path): Promise<Journal | null>; export async function writeJournal(path, j): Promise<void>   // atomic write (tmp + rename)
```
- [ ] Commit `feat(foreman): Feature Journal on disk — format, parse, atomic write`.

---

### Task 4 (FM1): Coordinator writes the journal for orchestrated runs

**Files:** `src/main/alicorn/foreman/journal-writer.ts`, `src/main/runtime/orchestration/coordinator-foreman-journal.ts` (sibling in the existing `coordinator-*.ts` decomposition), `coordinator.ts` (three call sites: run start, dispatch, worker_done/escalation), `preamble.ts` (orchestrated dispatch preamble gains a *Report* section stating the schema, ceiling and spill path, and the lead's preamble gains *Journal* instructions + `ORCA_ALICORN_STRATEGY=orchestrated` in the worker env).
- [ ] Tests: orchestrated task → journal created at run start, node dispatched/done logged, decisions preserved across a simulated restart (`Coordinator` re-created reads the journal); single task → no `.foreman/`. Commit `feat(foreman): coordinator journals orchestrated runs; resumable from disk`.

---

### Task 5 (FM3): Lead launch restrictions

**Files:** `src/main/alicorn/foreman/lead-launch-options.ts` (+ test), `src/main/claude/hook-settings.ts` (+ deny `PreToolUse` command for lead panes; the managed hook returns `{ decision: 'block', reason }` when `tool_name ∈ {Edit,Write,MultiEdit,NotebookEdit}` or (`tool_name ∈ {Read,Grep,Glob}` and the path is under the worktree and not under `.foreman/`)), `orchestration-worker-start-schema.ts` (`role: z.enum(['worker','lead']).optional()`), `orchestration-workers.ts` (apply `leadLaunchOptions(backend)`; `lead_backend_unsupported` for backends without tool restrictions), D2's `worker-member-launch.ts` hook point.
```ts
export function leadLaunchOptions(backend: MemberBackend): { disallowedTools: string[]; env: Record<string,string> } | { unsupported: true; reason: string }
// claude: disallowedTools ['Edit','Write','MultiEdit','NotebookEdit'], env ALICORN_ROLE=lead (hook reads it); codex: unsupported until an equivalent exists
```
- [ ] Tests: options per backend; hook command blocks Edit and allows Read under `.foreman/`; a lead dispatch carries `role: lead` and the env. Commit `feat(foreman): the lead writes no code and reads no implementation — enforced at launch and by a PreToolUse deny hook`.

---

### Task 6 (FM3): 40 % context ceiling and compaction

**Files:** `src/shared/alicorn/model-windows.ts`, `src/main/alicorn/foreman/lead-context-ceiling.ts` (+ test; reuses `contextTokensFromTranscriptTail` from D4), `lead-compaction-prompt.ts` (a fixed prompt: "write everything to the journal, then continue reading only the journal"), wiring into D4's watcher tick for panes with `role: lead` (one branch).
- [ ] Fixture transcript at 39 % / 41 % → below/at ceiling; unknown → null (do not block); at ceiling → `sendTerminalAgentPrompt(compactionPrompt)` once per compaction generation. Commit `feat(foreman): lead context ceiling at 40% of the model window with journal compaction`.

---

### Task 7 (FM4): Run view with cost meter

**Files:** `src/renderer/src/components/right-sidebar/run-view/RunView.tsx` (+ test), `use-run-view-state.ts`, IPC `alicorn:foreman:journal` (main reads the journal for the active run), cost from D7's `alicornRunCost` store summed over the run's dispatches (partial when any dispatch is `unavailable`).
- [ ] Component test with a journal fixture (4 nodes) and cost fixture (one unknown → "≥ $x (partial)"). Localise. Commit `feat(foreman): run view — plan nodes, status, running cost`.

---

### Task 8 (AT1, v2.0): Agent-composed teams — gated composition

**Files:** `src/main/alicorn/foreman/team-composer.ts` (+ test): `composeTeam(goal: string, members: Member[], history: Array<{ memberId; stageKey; acceptRate }>): TeamProposal` — picks one member per required role (`developer`, `reviewer` on a different backend, `qa`) preferring the highest windowed accept rate; the proposal is a decision gate (`question: 'Run with this team?'`) the human resolves; on accept the lead is dispatched with the proposal in its brief. **This is the thin, gated form; automatic composition without a gate is not in scope until evidence exists (CLAUDE.md sequencing rule 1).**
- [ ] Tests: role coverage, backend separation for the reviewer, gate created. Commit `feat(foreman): agent-composed team proposal behind a decision gate`.

---

### Task 9 (MR2, v2.0): multi-repo escalation signal — **depends on MR1 (interface & multi-repo plan)**; adds `repoCount > 1 → offer` to D4's watcher from the run's worktree tuples. One test. Commit `feat(foreman): offer orchestrated execution when a run spans repositories`.

### Task 10 (SM1): Success measurement protocol

**Files:** `docs/alicorn/FOREMAN.md` (§ *Measuring it*: the v0.1 `interruptions_per_completed_task` baseline; the v2.0 experiment — same ticket, one developer vs a Foreman run, time to mergeable PR and total spend; threshold agreed *before* running; record in Plane), CLI `alicorn ledger report --compare-runs <a> <b>` (reads both runs' cost + interruptions from the ledger).
- [ ] Commit `docs(foreman): lead specification and the measurement protocol`.

---

### Task 11 (FM5): reduce before synthesize; hidden-dependency check

**Files:** `src/main/alicorn/foreman/reduce-reports.ts` (+ test), `wave-dependency-check.ts` (+ test), `journal.ts` (`JournalNode.files: string[]` optional; `Journal.waves: Array<{ n: number; nodeIds: string[]; reducedPath: string | null; overlaps: Array<{ path: string; nodeIds: string[] }> }>`), `coordinator-foreman-journal.ts` (call sites: before dispatching a wave, after the last `worker_done` of a wave), `preamble.ts` (lead preamble: "read the wave table, not the reports").
```ts
export function reduceReports(reports: Array<{ nodeId: string; report: ForemanReport }>): { table: string; overlaps: Array<{ path: string; nodeIds: string[] }>; totals: { tokensIn: number | null; tokensOut: number | null } }
// table: one Markdown row per node (status, summary, #changes, verification result, open questions count, cost); overlaps: paths present in ≥ 2 reports' changes
export function planWaves(nodes: JournalNode[]): string[][]
// topological waves by dependsOn; within a wave, nodes with overlapping declared files are split into successive waves (deterministic: earlier id first)
```
- [ ] Tests: two nodes sharing `src/a.ts` → two waves + journaled overlap; reduce table has one row per node and flags the shared file; lead prompt references the table path and not the report bodies. Commit `feat(foreman): reduce a wave into one table before the lead reads it; serialise hidden dependencies`.

### Task 12 (FM6, spike): Claude Code `workflow` as an executor

**Files:** `src/main/alicorn/foreman/export-claude-workflow.ts` (+ test): `exportClaudeWorkflow(journal: Journal): string` emits a script with `export const meta = { name, description, phases }` and one `agent()` per node inside `parallel()`/`pipeline()` by wave, each agent prompt = the node's brief + the FM2 report contract; CLI `alicorn foreman export --run <id> --format claude-workflow`. Then run **one** real ticket both ways (coordinator vs exported workflow) under SM1's protocol and record the result in `docs/alicorn/FOREMAN.md` § *Measuring it*. Outcome of the spike is a decision, not a feature.
- [ ] Tests: export of the fixture journal is valid JavaScript (parsed with `acorn` already in the toolchain or `new Function` in a test), waves map to `parallel` blocks. Commit `feat(foreman): export a Feature Journal plan as a Claude Code workflow (spike)`.

## Self-review

- **Coverage.** FM1 (3, 4), FM2 (1, 2), FM3 (5, 6), FM4 (7), AT1 (8), MR2 (9), SM1 (10), FM5 (11), FM6 (12). The three "ours to keep" rules from CLAUDE.md each have an enforcing task (5; 1+2; 3+4). Tasks 11–12 come from `docs/alicorn/GRAPH-ENGINEERING.md`; run 11 right after 4 (it changes the journal shape) and 12 after 7.
- **Placeholders.** Task 9 is explicitly dependent on MR1 and small; Task 8 is deliberately thin and gated.
- **Types.** `ForemanReportSchema` (Task 1) is what Task 2 validates and Task 4's preamble teaches; `Journal`/`JournalNode` (Task 3) feed Tasks 4 and 7; `leadLaunchOptions` (Task 5) is applied in the D2 launch path.
- **Order.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → (8, 9, 10). Needs on `main`: D1, D2, D4, D7.
