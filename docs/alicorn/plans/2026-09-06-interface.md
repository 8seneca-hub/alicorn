# Interface Implementation Plan (post-v1.0, before v1.5 closes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Sequencing (CLAUDE.md decision 6 + fork posture):** interface work starts immediately after v1.0 and *after the rebrand CI gate is green* (the tab model is the file set most likely to conflict with upstream merges). Re-verify every anchor when picking a task up.

**Goal:** The two Alicorn departures from upstream — *a tab is a session, not a workspace* (status and running cost on every tab) and *a new tab opens an agent, not a shell* (terminal in the right sidebar) — plus the Context Inspector, the five design-system aliases, and voice routed to an agent as a prompt with a confirmation before destructive intent.

**Architecture:** Land the visible value before the risky re-keying: per-tab status rollup and cost badge first (no persistence change), then the tab=session re-keying as a persisted-schema migration with a legacy fallback, exactly as `unifiedTabs` was introduced. "Agent by default" is two existing knobs flipped plus a new `terminal` right-sidebar panel following the seven existing panels' lazy-branch pattern. Voice adds one decision layer between the final transcript and delivery: agent-directed transcripts go through the backend-neutral `sendTerminalAgentPrompt`, destructive ones wait for confirmation.

**Tech Stack:** `src/shared/tab-types.ts`, `workspace-session-state-types.ts`, `reconcile-hydrated-workspace-tab-models.ts`, `src/main/persistence/*` migrations, `agent-status-projection.ts`, `RightSidebarTab` union + `right-sidebar-panel-content.tsx`, `default-global-settings.ts`, `dictation-insertion-target.ts`, `sendTerminalAgentPrompt`, `main.css` tokens, vitest/happy-dom.

**Spec:** `CLAUDE.md` → *Interface decisions specific to Alicorn*; `docs/alicorn/DESIGN-SYSTEM.md` (Tokens: 5 aliases); `docs/alicorn/PROJECT-BRIEF.md` §07; `docs/alicorn/ROADMAP.md` (Interface); research `research/interface-multirepo-mailbox.md`. Plane: UI1, UI2, UI3, UI4, VI1 (module *Interface*, owner Nghia).

## Global Constraints
- **Reuse `native-chat`, `right-sidebar`, `new-workspace`** — a change of default, not new machinery.
- **Persisted session shape changes ship with a migration and a read-path fallback** (the `unifiedTabs` precedent); no data loss for old sessions (equivalence test).
- **Cost on a tab comes from D7's run-cost store**; unknown renders as "—", never a guess.
- **Design tokens: exactly the five aliases** `--status-live`, `--status-attention`, `--status-critical`, `--focus-ring: 2px`, `--motion-fast: 150ms`, each aliasing an existing Orca token; the prototype `tokens.css` is reference only; `.dark` class theming stays.
- **Voice never types into a PTY when the target is an agent tab**; delivery is `sendTerminalAgentPrompt` (backend-neutral); destructive intent always confirms.
- Cross-platform shortcuts (`metaKey`/`ctrlKey` by platform); folder workspaces and SSH respected; i18n by tooling; no `mode` fields; no AI attribution.

## Decisions
1. **UI1 in two steps**: (a) rollup + cost badge without re-keying; (b) re-keying `unifiedTabs`/`tabGroups` to a flat `sessionsById` with `worktreeId` as a field, behind `WorkspaceSessionState.tabModelVersion = 2`, migration + fallback. (b) is the ceiling item; it ships alone.
2. **Tab status = the highest-priority pane state** (`working > waiting_input > error > idle`) among the tab's panes; cost = sum of known dispatch spend for the tab's run(s).
3. **Terminal panel** = new `RightSidebarTab 'terminal'` hosting the existing terminal pane component bound to the active worktree; shortcut `Cmd/Ctrl+J` toggles it (platform-checked).
4. **Default agent** = `settings.defaultTuiAgent ?? first installed supported agent`; the composer's blank choice remains reachable as "Shell only".
5. **UI3 = Context Inspector only** (context captures + provenance link); the run view is FM4 (Foreman plan) and the provenance panel is PV1 (gates plan) — no duplicate surfaces.
6. **Voice routing**: target = the focused agent tab's terminal handle when its pane is an agent session; otherwise legacy insert. Destructive = transcript matches a small verb list (`delete, drop, remove, rm, reset --hard, force push, deploy, destroy`) → confirmation dialog; setting `voice.confirmBeforeDestructive` (default true) alongside the existing `terminalConfirmBeforeInsert`.

## Tasks

### Task 1 (UI4): five design-system aliases
`src/renderer/src/assets/main.css`: in `:root` and `.dark` add `--status-live: var(--status-success); --status-attention: var(--agent-question); --status-critical: var(--destructive); --focus-ring: 2px; --motion-fast: 150ms;` and expose the three colours in `@theme inline` (`--color-status-live` …). Test: `main-css-tokens.test.ts` reads the file and asserts the five names exist in both blocks and no existing token line changed (snapshot of the pre-existing token names).
- [x] Commit `feat(design-system): five Alicorn token aliases`.

### Task 2 (UI2a): agent tabs open in chat by default
`default-global-settings.ts`: `experimentalNativeChat: true`, `openAgentTabsInChatByDefault: true`; move the setting from `ExperimentalPane` to the General pane as "Open agent tabs in chat" (`NativeChatExperimentalSetting.tsx` renamed `AgentTabChatSetting.tsx`). Test: fresh settings → `decideInitialAgentTabViewMode` returns `'chat'` for a supported agent.
- [x] Commit `feat(interface): agent tabs open in chat by default`.

### Task 3 (UI2b): a new tab opens an agent
`AgentCombobox.tsx`: `BLANK_VALUE` is labelled "Shell only" (the pre-rename "Blank Terminal" stays a search alias in `agent-picker-search.ts`). Decision 4 needs no new code — `pickQuickWorkspaceAgent` in `quick-workspace-agent-selection.ts` is already `settings.defaultTuiAgent ?? first installed supported agent`, and `NewWorkspaceComposerModal` already feeds it to the composer, so a fresh profile lands on an agent rather than a shell. Test: fresh settings → the composer default resolves to an installed agent.

**The seeding clause was dropped, deliberately.** This task originally also changed `worktree-initial-terminal-seeding.ts` to launch the default agent whenever a tab is auto-seeded. Creation already opens an agent (the composer supplies the startup), so the clause added only *agent-on-reactivation* — and that re-arms the relaunch loop guarded by `worktree-activation-created-agent.test.ts` and `worktree-reactivation-tab-forkbomb.test.ts`: each activate/close cycle would spawn a fresh agent process. Those ratchets outrank the clause. If reopening an emptied workspace should start an agent, it needs its own design with a relaunch guard, not a flag on the seeding path.
- [x] Localise. Commit `feat(interface): new tabs open an agent, not a shell`.

### Task 4 (UI2c): terminal in the right sidebar
`ui-chrome-types.ts` (`'terminal'` in `RightSidebarTab`), `right-sidebar-effective-tab.ts` (+ test case), `right-sidebar-panel-content.tsx` (lazy `TerminalPanel`), `right-sidebar/terminal-panel/TerminalPanel.tsx` (hosts the existing terminal pane component for the active worktree; folder workspaces and SSH hosts use the same pane), activity-bar entry + `Cmd/Ctrl+J` accelerator (platform-checked; label `⌘J` / `Ctrl+J`). Tests: effective-tab; render mounts the pane; shortcut mapping per platform.
**Blocked on Task 6 — the panel has nowhere to keep its session.** The scaffolding (`'terminal'` in
`RightSidebarTab`, the route normalizer, effective-tab, activity-bar entry, the keybinding) is
straightforward; the session host is not, and both available shapes were checked against the code and
rejected:

- *A synthetic worktree id*, the way the floating terminal uses `FLOATING_TERMINAL_WORKTREE_ID`, is
  **local-only by design**: `getConnectionId(FLOATING_TERMINAL_WORKTREE_ID)` returns `null` and
  `isWorktreeConnectionResolved` returns true for it (`connection-context.test.ts`, #6831). A sidebar
  terminal keyed that way could never reach an SSH host or resolve a folder workspace's per-file
  owner — the two cases this task explicitly requires.
- *A tab in the real worktree*, which would inherit host resolution correctly, cannot be kept out of
  the main area: `layoutSpanningGroups` (`store/slices/tab-group-reference-repair.ts:13`) splices
  **every** group of a worktree into the tab layout, so a sidebar-owned group reappears as a split in
  the main view. Hiding it needs a new tab-model concept threaded through the `*ByWorktree` readers —
  which is precisely what Task 6 consolidates behind `selectTabsForWorktree`.

**Amended 2026-09-07 — unblocked without Task 6.** The second bullet's conclusion holds but its remedy
was too large. `layoutSpanningGroups` has exactly one caller (`store/slices/tabs-hydration.ts:222`),
so marking the sidebar's `TabGroup` as sidebar-owned and filtering it there keeps it out of the main
layout — no new tab-model concept, no re-keying, and the group still carries the real `worktreeId`, so
SSH and folder-workspace host resolution work exactly as in the main area (which is what ruled out
`FLOATING_TERMINAL_WORKTREE_ID`). The pane itself is `components/terminal-pane/TerminalPane`, which
needs only `{ tabId, worktreeId, isActive, onPtyExit, onCloseTab }` — the same unit the floating
terminal hosts. Keep the first version to **one** sidebar terminal per worktree: no tab bar, no
parking, no drag. Also note the shortcut in this task's heading is unavailable:
`Mod+J` / `Mod+Shift+J` is `worktree.palette` (`keybindings/definitions-core-1.ts:39`), the tipped
Cmd+J jump palette. Use `Mod+\`` — VS Code's terminal-toggle convention, unused in our definitions,
and identical on every platform.
- [x] Localise. Commit `feat(interface): terminal panel in the right sidebar`. **Landed without Task 6**
  — sidebar-owned `TabGroup.surface`; `Mod+Backquote`; `createTab` layout-seed guard;
  `normalizeRightSidebarRoute` and `STATIC_RIGHT_SIDEBAR_TABS` both needed the new tab.

### Task 5 (UI1a): tab status rollup and cost badge
`src/renderer/src/lib/tab-status-rollup.ts` (pure, Decision 2: `rollupTabStatus(entries: AgentStatusEntry[]) → TabStatus`), `tab-cost.ts` (`tabCostCents(runCosts, tabRunIds) → { cents: number | null; partial: boolean }` from D7's store), tab bar: status dot (`--status-live/attention/critical`) + cost text ("$0.42", "≥ $0.42" partial, "—" unknown). Tests: rollup priority; cost partial/unknown; component renders badges.
**Amended 2026-09-07 — both halves land, and neither needed Task 6.** The prior amendment above was
wrong on two counts, corrected against the code:

- *The status rollup already ships.* `components/tab-bar/terminal-tab-activity-status.ts` buckets
  `agentStatusByPaneKey` by `identity.tabId` — that **is** rolling several panes up to one tab — and
  `SortableTab.tsx:103` renders the result. The pane→tab relation lives in the pane key
  (`shared/stable-pane-id.ts`), not in the tab model, so Task 6 does not own it and never blocked it.
  Nothing was built here; only `parseAgentStatusPaneKey` was exported for reuse.
- *D7 has a renderer counterpart.* `store/alicorn-run-cost-store.ts` plus `hooks/useAlicornRunCost.ts`
  shipped with D7; the sidebar agent row and the Foreman run view already read them.

Built instead of the planned `lib/tab-status-rollup.ts` + `tab-cost.ts`: one resolver,
`components/tab-bar/terminal-tab-run-cost.ts`, which reuses **D7's own** `summarizeRunCost` /
`formatRunCostSummary` (`shared/alicorn/run-cost.ts`) rather than restating the floor-vs-figure rule a
third time — those already give `$0.42` / `≥ $0.42 (partial)` / `—`. `TabRunCostBadge.tsx` renders it,
absent entirely for a tab that never dispatched (a dash on every shell tab is noise, not information).
Decision 2's vocabulary is moot: the existing resolver speaks `WorktreeStatus`, deliberately shared
with the sidebar card.
- [x] Localise. Commit `feat(interface): per-tab running cost badge`.

### Task 6 (UI1b): tab = session re-keying + migration
`tab-types.ts` (`Tab.sessionId: string` = tab id; `worktreeId` stays a field), `workspace-session-state-types.ts` (`tabModelVersion?: 2`, `sessionsById?: Record<string, Tab>`, `tabGroupsBySession?`), `reconcile-hydrated-workspace-tab-models.ts` (reconcile by session, grouping by `worktreeId` for the existing `reconcileWorktreeTabModels` call), migration `src/main/persistence/workspace-session-tab-model-v2.ts` (v1 → v2, lossless; read-path fallback when `tabModelVersion` absent), store slices under `store/slices/tabs/*` read through one selector `selectTabsForWorktree(state, worktreeId)` so the dozen `*ByWorktree` readers change in one place. Tests: migration equivalence (mirrors `workspace-session-salvage-equivalence.test.ts`) — old sessions hydrate to identical visible tabs; selector tests; reconcile test updated.
**Amended 2026-09-07 — measured, and it is ~15× what this task claims.** "The dozen `*ByWorktree`
readers change in one place" is wrong: `unifiedTabsByWorktree` appears in **174 non-test files** (382
counting tests) and `tabsByWorktree` in **962 references**. This is a persisted-schema migration
across the most-referenced shape in the renderer, not a contained re-key.

It is also **not a dependency of anything else in this plan**, contrary to the resequencing note in
the self-review:

- Task 5 never needed it — the pane→tab rollup lives in the pane key (see Task 5's amendment), and it
  has shipped.
- Task 4 needs one thing from it: somewhere to keep a session that is not in a worktree's layout.
  `layoutSpanningGroups` has exactly **one** caller (`store/slices/tabs-hydration.ts:222`), so a
  `TabGroup` marked as sidebar-owned and filtered at that call site expresses it without re-keying
  anything. That is the route Task 4 takes.

So this task keeps UI1's *name* but none of its remaining user-visible value: per-tab status and
running cost are both on the tab already. What is left is the internal identity change (a tab keyed by
session rather than worktree), which buys multi-repo sessions later. **Do not schedule it as part of
this plan** — re-scope it as its own ticket, sized against the numbers above, and sequence it with the
multi-repo feature workspace (MR1) that actually wants it.
- [x] Re-scoped as **ALC-100 (UI5)** on 2026-09-07, carrying the measurement above; sequenced with MR1.

### Task 7 (UI3): Context Inspector
`right-sidebar/context-inspector/ContextInspectorPanel.tsx` (+ test): for the active tab's run, list context captures (`GET /v1/ledger/provenance` → captures per dispatch: prompt, `contextSlice` metadata, `promptSha256`, truncated flag) with a "what the member saw" view; link to the provenance panel. IPC `alicorn:context:list` via `alicornFetch('ledger', …)`. Depends on D5 (captures) and PV1.
- [ ] Localise. Commit `feat(interface): context inspector — what the member saw`.

### Task 8 (VI1): voice to agent prompt
`src/shared/speech-types.ts` (`VoiceSettings.confirmBeforeDestructive?: boolean`, default true in settings), `dictation/dictation-intent.ts` (pure: `classifyDictation(text, target) → { route: 'agent_prompt' | 'insert'; destructive: boolean }` per Decision 6), `DictationController.tsx` (route `agent_prompt` → `terminal.send` RPC → `sendTerminalAgentPrompt`; destructive → `ConfirmDestructiveDictationDialog`), settings toggle. Tests: classification table; agent-directed transcript calls the mocked send path not `insertText`; destructive held until confirmed.
**Partly landed 2026-09-07 — the classifier is in; delivery needs one decision this plan did not
make.** `dictation/dictation-intent.ts` + its classification table shipped (21 cases, including the
false-positive guards: `format`/`warm` must not match `rm`, and both spoken forms `reset hard` /
`force-push` must match). Two corrections to the task text:

- *Delivery is `submitPromptToAgentPty`* (`lib/agent-paste-draft.ts`), not `terminal.send`. The
  renderer already owns agent-prompt delivery: bracketed paste plus Enter inside
  `runTerminalPtyInputTransaction`, so a concurrent paste cannot submit a half-written prompt.
  `terminal.send` is the raw-PTY write and would type the transcript as keystrokes — exactly what the
  global constraint forbids. `sendTerminalAgentPrompt` is the main-process end of the same idea.
- *Routing and destructiveness are independent.* Decision 6 reads as though the confirmation belongs
  to the agent route; it does not. "rm the build output" typed into a live shell is the more dangerous
  of the two, so the classifier flags on the words alone and the caller gates either route.

**The open decision: final transcripts arrive as a stream of segments, not one string.**
`onFinalTranscript` fires repeatedly within one dictation session and the insert path appends each
segment as it lands (`formatFinalTranscriptSegment`). An agent prompt cannot work that way — each
segment would paste *and press Enter*, submitting three partial turns for one sentence. So the agent
route has to buffer every segment and submit once when the session stops, which makes
`DictationController`'s lifecycle (not just its insert call) part of this task, and raises questions
this plan should answer first: what happens to a buffered prompt when dictation errors or is
cancelled, and whether the indicator should show the buffer while it fills.
- [x] Commit `feat(interface): classify a dictated transcript — agent prompt vs insert, destructive or not`.
**Decided and landed 2026-09-07.** Both open questions were answered conservatively:
*an errored or cancelled session discards its buffer* (a truncated transcript is likely cut
mid-sentence, and a half-heard instruction reaching an agent is worse than one that never arrives;
aborting is not a request to send what had been said so far), and *no new indicator UI* — the dialog
shows the transcript verbatim instead, because STT mishears and the point of the pause is to see what
would actually be sent.

One limit worth knowing: **routing only fires for a single-pane agent tab.** A split inside an agent
tab can be a plain shell, and `DictationInsertionTarget` carries the DOM's numeric pane id rather
than the pane key's leaf id, so the focused half of a split is not identifiable without new plumbing.
Ambiguity falls back to typing, because sending `ls -la` to an agent as a prompt is worse than typing
a sentence into a shell. Lifting this needs the target to carry a leaf id.
- [x] Localise. Commit `feat(interface): voice routes to the agent as a prompt; destructive intent confirms`.

### Task 9: docs — as built
`CLAUDE.md` *Interface decisions* carries both departures as built: the tab-bar half of "a tab is a
session" shipped without the re-keying (and why it never needed it), and the sidebar terminal's group
surface, `Mod+Backquote`, and the four edits a new right-sidebar tab actually costs.
`docs/alicorn/DESIGN-SYSTEM.md` records that the five aliases live in `main.css` and that the
prototype `tokens.css` is reference-only. No migration note: there is no migration, because Task 6
was re-scoped out.
- [x] Commit `docs(alicorn): interface as built`.

## Self-review
UI4 (1), UI2 (2, 3, 4), UI1 (5, 6), UI3 (7), VI1 (8). Constraints: reuse existing surfaces (2–4); migration + fallback (6); cost from D7 (5); exactly five aliases (1); voice via `sendTerminalAgentPrompt` + confirm (8). Types: `TabStatus`/`rollupTabStatus` (5) rendered by 6's tab bar; `Tab.sessionId` (6). Order **1 → 2 → 3 → 5 → 4 → 8 → 9**, with **6 removed from this plan** (re-scoped; see its amendment).
The earlier "Task 6 first" resequencing was based on a dependency that does not exist: neither 4 nor 5
needs the session-keyed model. Task 5 shipped 2026-09-07; Task 4 is next and is self-contained; Task 7
still needs D5 + PV1, and D5 has shipped while PV1 has not, so 7 stays out until PV1 lands.
