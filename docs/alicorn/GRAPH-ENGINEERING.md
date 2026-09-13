# Graph engineering, loaded into Alicorn

_Added 2026-09-06 from two posts Huy and Nghia shared. This note records what the framework says,
where Alicorn already has it, and the four things we adopt because of it._

## Sources

- Anatoli Kopadze, _Graph Engineering explained: what it is, when to use it and when not to_ (X
  article, quoted in <https://x.com/anatolikopadze/status/2096220112277713313>), with a talk by the
  head of Claude Code: "85% of our engineers are running dozens or hundreds of agents. The way you do
  it is graph engineering."
- @hanakoxbt, _Loops and Graphs: how to stop babysitting agents and only approve the last step_ (X
  article, quoted in <https://x.com/res1dualedge/status/2095968459939344561>), framing Sam Altman's
  progression **Prompts → Agents → Loops → Graphs**. The paid course behind it
  (agent-layers.vercel.app) was not read; only the public article was.

## What the framework says

- **A loop is a check that can fail.** Produce, check, correct, repeat until green. The check is
  programmatic, written first; the loop lives _inside_ a unit of work.
- **A graph is the layer above.** Nodes are bounded jobs, edges are dependencies. The graph decides
  what runs, what runs in parallel, and in what order. The loop lives inside a node; the graph lives
  between them.
- **Four kinds of node.** _Splitter_ (decomposes; the most consequential design choice), _worker_
  (one unit, isolated context), _code node_ (deterministic transformation — merge, rank, dedupe —
  never routed through a model), _gate_ (approval).
- **Two return paths.** A short **correction edge** sends a failed unit back to the step that
  produced it. A long **learning edge** feeds a constraint back to the splitter so the next run does
  not repeat the mistake.
- **Gate by blast radius, not confidence.** Three lanes: reversible and contained → open; reversible
  but wide → deterministic checks; hard to reverse → closed, period. Put the human at the point of
  highest consequence and lowest reversibility: approve the merge, not the intermediate steps.
- **The diamond.** Fan out, reduce with code, synthesize. A worker and its verifier must never share
  a context.
- **The fake-edge test.** Does this step actually need the result of the one before it? Most
  sequential pipelines are parallel work with fake edges.
- **Failure modes.** Context collapse (too many outputs feeding one step), false independence (shared
  files, rate-limited APIs), silent node failures. **Anchors:** verification must touch reality —
  tests that actually ran — not a model judging a model.
- **When not to.** Small isolated tasks, tight approval, exploratory work, genuinely sequential
  dependencies. Twenty agents at once with fake edges is still sequential, at twenty times the cost.

## Where Alicorn already has it

| Framework                                 | Alicorn                                                                                                                                                                             | Where                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Graph                                     | Workflow: stages + transitions, one model with a board view and a canvas                                                                                                            | ROADMAP v1.5, WF1/WF2                     |
| Node                                      | Stage (workflow) · plan node in the Feature Journal (Foreman)                                                                                                                       | ARCHITECTURE §6, FM1                      |
| Splitter                                  | The Foreman lead: writes no code, reads no implementation, decomposes and re-plans                                                                                                  | CLAUDE.md _Foreman is an add-on_, FM1–FM3 |
| Worker                                    | A Member dispatched with a fresh context and a bounded brief                                                                                                                        | tier 1, D2                                |
| Gate                                      | The autonomy policy evaluated at every hand-off; decision gates                                                                                                                     | ARCHITECTURE §7, GP1–GP3                  |
| Correction edge                           | The return transition (Review → Build on a failed check), first-class on the canvas                                                                                                 | ROADMAP v1.5, WF2                         |
| Learning edge                             | The Rulebook: an amendment proposes a standing rule on the member that caused it                                                                                                    | PROJECT-BRIEF §11.3, RB1                  |
| Blast radius over confidence; three lanes | `evaluateGate` order: hard stops (`irreversible`, `inherited_cost`) first, then verification, then blast-radius budgets, then evidence; `reversibility` is authored, never inferred | ARCHITECTURE §7, BR1                      |
| Human at the merge                        | Merge and deploy gate regardless of track record — _hard stops never retire_                                                                                                        | CLAUDE.md invariants                      |
| Worker and verifier never share a context | Reviewer backend ≠ author backend, enforced; a QA member never reads the implementation                                                                                             | tier 1 item 5, QA1                        |
| Anchors                                   | `step_verifications` record commands that ran and their evidence; provenance and the PR body are built from them                                                                    | tier 1 items 2 and 4                      |
| Context collapse                          | Bounded reports with a hard ceiling; the lead's 40 % context ceiling                                                                                                                | FM2, FM3                                  |
| Silent node failures                      | Heartbeats, lifecycle reconciliation, journal node statuses                                                                                                                         | Orca orchestration, FM1                   |
| When not to use a graph                   | `execution_strategy: single` is the default and stays so; `orchestrated` is opt-in with the meter visible; escalation is offered, never applied                                     | CLAUDE.md _Execution: two axes_           |
| Loops                                     | Required checks plus the correction edge inside a stage; the fix loop in the development process                                                                                    | tier 1 item 4, WF2                        |
| Prompts → Agents → Loops → Graphs         | An ADE _is_ the graph layer: the unit of work is a ticket, agents hand work to each other, a human is interrupted only at gates                                                     | CLAUDE.md _What we are building_          |

Two places the framework and Alicorn differ on purpose:

- **The gate is a property of every hand-off, not a node.** A gate node would let a workflow author
  forget one. Evaluating the policy at every transition is what makes _hard stops never retire_
  enforceable rather than advisory.
- **The splitter is not a stage kind.** It is what runs when a task or stage has
  `execution_strategy: orchestrated`. Making it a node kind would reintroduce a third "mode".

## What we adopt (new work)

| Key                 | Addition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why the framework changed our mind                                                                                                                                                                       | Plan             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **WF5** — _shipped_ | `stages.kind = worker \| code`. A **code stage** runs a deterministic command (merge, rank, dedupe, format, generate) with no model and no member; it produces a `step_outcome` (`backend: 'code'`, no `member_id`) like any stage and takes the forward or correction edge on its exit status, gating with reason `unverified` when the graph has no correction edge for the failure. Local execution only — an SSH-hosted workspace refuses rather than running the command on the wrong host. | Token efficiency: routing deterministic work through a model is the most common waste the framework names. Today every stage assumes a member.                                                           | workflows-stages |
| **WF2** (amended)   | `transitions.kind = forward \| correction`; the canvas also renders **learning edges** from Rulebook data (rules attached to a member on that stage).                                                                                                                                                                                                                                                                                                                                            | Naming the two return paths distinctly makes the canvas teach the model the framework teaches.                                                                                                           | workflows-stages |
| **FM5**             | **Reduce before synthesize, and a hidden-dependency check.** When a wave of workers completes, a code step merges their bounded reports into one table (status, summary, files, open questions, cost) and flags any file touched by two workers in the same wave; the lead reads the table, never N reports. Before dispatching a wave, nodes whose declared files overlap are serialised and the overlap is journaled.                                                                          | Context collapse and false independence are the two failure modes the framework says kill fleets. FM2 bounds one report; nothing bounded the sum.                                                        | foreman-core     |
| **RB2**             | **The learning edge reaches the splitter.** Accepted rules on a member also render into the Foreman lead's brief for any task that dispatches that member.                                                                                                                                                                                                                                                                                                                                       | A rule the worker sees but the planner does not still produces the same decomposition mistake.                                                                                                           | rulebook         |
| **FM6**             | **Spike: Claude Code's `workflow` feature as an executor.** Export a Feature Journal plan as a Claude Code workflow script (agents, parallel, pipeline, phases) and run one real ticket both ways against SM1's measurement protocol.                                                                                                                                                                                                                                                            | Claude Code ships a graph runner for its own backend; if it wins on the Claude backend, the Foreman coordinator stays the backend-neutral shell and delegates execution. Decide with numbers, not taste. | foreman-core     |

## What we do not adopt

- Graphs as the default path. `single` stays the default; the public figure is ~90 % better results
  for ~15× the tokens on research tasks, unmeasured on shipping features (CLAUDE.md).
- Confidence scores anywhere in gate evaluation.
- A graph library for the canvas; workflows are near-linear and the canvas is hand-rolled SVG.
- The five-layer vocabulary (prompt / context / harness / loop / graph) as product structure. It is a
  good teaching order and maps onto the four pillars; it is not a module list.
