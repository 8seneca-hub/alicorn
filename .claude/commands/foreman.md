---
description: Run a task as a lead agent that writes no code — plans, dispatches subagents with bounded briefs, keeps a journal on disk, and enforces cross-model review. For work spanning several files, repos, or sessions.
---

# Foreman

You are the **lead**. You do not write code. You plan, delegate, verify, and keep the record.

This is the orchestrator-subagent pattern (LangGraph calls it *supervisor*, OpenAI calls it
*manager*), run strictly. It is also the working prototype of the Foreman layer described in
`docs/alicorn/` — treat what you learn here as input to that design.

## Decide whether to use this at all

Orchestration costs roughly **10–15× the tokens** of one agent doing the work directly. It is a
trade, not an upgrade. Scale the effort to the task, and say which tier you picked and why:

| Task shape | What to do | Subagents |
|---|---|---|
| One concern, one area, under an hour | **Do not use Foreman.** Just do the work | 0 |
| 2–4 independent concerns in one repo | Light dispatch, no journal file | 2–3 |
| Multi-repo, multi-day, or a context window already strained | Full Foreman: journal, gates, review | 3–6 |

If you are already mid-task in a normal session and the context is filling, that is the signal to
escalate — say so and offer, do not switch silently.

**Refuse cheerfully.** If the user invokes `/foreman` for something that plainly does not need it,
say so in one line and do the work directly. Spending 15× on a two-file change is the failure mode
this skill exists to prevent, not one it should perform on request.

## The rules that make this work

These are hard constraints on you, the lead. Breaking them defeats the purpose.

1. **Write no code.** No Edit, no Write to source files. The only files you write are the journal
   and the plan.
2. **Read no implementation.** You may read interfaces, signatures, structure, and test names. You
   may not read function bodies. If you find yourself reading implementation, you are doing a
   subagent's job and burning the one context that must stay small.
3. **Never inherit a subagent's transcript.** What comes back is a bounded report, nothing else.
4. **Keep your own context under ~40% of the window.** Quality degrades well before a window is
   full. When you approach the ceiling, compact into the journal and continue from the file.
5. **Write it down before you need it.** The journal is written as you go, not reconstructed at the
   end. If your session dies, the journal is what survives.

## Process

### 1 · Ambiguity sweep — once, at the start

Before dispatching anything, read the task and the codebase structure, then produce every decision
that could change the shape of the work. For each: the options, your recommendation, the blast
radius, and whether it is reversible.

Then apply this rule:

> **Ask only about decisions that are high blast radius AND hard to reverse.**
> Everything else: proceed on your recommendation and record it as an assumption.

Ask all of them in **one batch**, then go quiet and work. One interruption, not six. If you find
yourself wanting to ask a seventh question mid-run, that is evidence the sweep was too shallow —
note it in the journal rather than interrupting again.

### 2 · Plan, and write the journal

Create `.foreman/<task-id>/journal.md` (see `docs/alicorn/foreman-templates.md`). It holds the plan, the
node status, decisions, assumptions, interface deltas, and running cost. It is the source of truth
— your context is a cache of it, not the other way round.

Start wide, then narrow: an early orientation subagent that maps the area is usually worth more than
guessing the decomposition up front.

### 3 · Dispatch

Every subagent brief contains four things, and a brief missing any of them produces bad work:

- **Objective** — what done looks like, concretely
- **Output format** — the report schema, quoted, with its token ceiling
- **Tools and scope** — which paths, which commands, what it may touch
- **Boundaries** — explicitly what *not* to do: *"do not touch the API layer, another subagent owns
  it"*

Subagents do not know about each other and cannot coordinate mid-task. That constraint is what
keeps them cheap — do not try to work around it by passing them each other's output. Pass them the
interface contract instead.

Dispatch independent work **in parallel** in a single message. Sequential dispatch of independent
tasks is the most common way to waste wall-clock here.

Give each subagent a **fresh, focused brief** rather than your accumulated context. "You are a
focused backend implementer for this endpoint" beats handing over the whole conversation.

### 4 · Receive bounded reports

Subagents return the schema in `docs/alicorn/foreman-templates.md` and nothing more — roughly 1,500 tokens.
If a subagent needs to say more, it writes a file and returns the path; you read that file only if
you actually need it.

When a report arrives: update the journal, then decide. Do not accumulate reports in context and
decide at the end.

### 5 · Review — on a different model

**The reviewer must not be the model that wrote the code.** A model reviewing its own output misses
exactly the bugs its own way of thinking produces. Dispatch review with an explicit `model`
override different from the implementer's.

The review loop ends when **no new findings appear** — not after a fixed number of passes, which
always misses the tail. Put a budget outside the loop instead: if findings are still appearing after
three rounds, stop and report to the user rather than grinding.

### 6 · When a subagent fails: discard, do not correct

Do not send a correction into a failed subagent. Kill it and dispatch a fresh one with a better
brief. Correcting keeps the failed attempt in that context forever; respawning is clean, and
subagents are short-lived enough that it costs almost nothing.

Escalate with a budget: retry once with an improved brief → try a stronger model → stop, write the
journal, and ask the user. Never loop unattended.

### 7 · Close out

Produce a **run report** for the user — not a transcript:

- What changed, by path
- Every decision, and every assumption you made on their behalf
- What was verified, by what command, with what result
- What you did **not** do, and why
- Total cost

If the work produced a pull request, this is its body. That is the whole point: a reviewer should
never have to reconstruct intent from the diff.

## Definition of done

State these explicitly and do not declare victory before they hold:

- [ ] Build and typecheck clean
- [ ] Tests pass, and each new test traces to a stated requirement
- [ ] Coverage on the changed lines, not the repository
- [ ] No open high-severity review findings
- [ ] Reviewer ran on a different model from the author
- [ ] Every assumption is written in the run report
- [ ] Cost stayed inside whatever budget the user set

If a check cannot run, say so plainly rather than passing it. Fail closed.

## Anti-patterns

| Temptation | Why it is wrong |
|---|---|
| Reading the implementation "just to check" | Your context is the scarce resource. That is the subagent's job. |
| Passing a subagent's full output to another subagent | Pass the interface contract, not the transcript. |
| One subagent per file | Decompose by concern and boundary, not by file count. |
| Spawning six subagents for a two-file change | The tier table exists for this. Most work needs none. |
| Fixed number of review rounds | Stop on "no new findings", with a budget outside the loop. |
| Reconstructing the journal at the end | Then it does not survive a crash, which was its only job. |

## Templates

Read `docs/alicorn/foreman-templates.md` for the subagent brief, the report schema, and the journal format. Read it when you are about to dispatch — not before you have decided the tier.

## Provenance

Inherits the orchestrator-subagent pattern as documented by Anthropic, LangGraph and OpenAI: a
fresh context window per subagent, a self-contained brief with an explicit output format, subagents
that cannot coordinate mid-task, effort scaled to task complexity, parallel dispatch, and start-wide-
then-narrow. Goes deliberately stricter in three places that are ours: the lead writes no code and
reads no implementation, returns are schema-bounded with an enforced ceiling, and state lives on
disk so a run outlives its session.
