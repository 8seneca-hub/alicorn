import {
  ALICORN_STRATEGY_ENV,
  FOREMAN_REPORT_MAX_TOKENS,
  ForemanReportSchema
} from '../../../shared/alicorn/foreman-report'

/**
 * What an orchestrated worker is told about reporting.
 *
 * The ceiling is enforced at the CLI, not advised here — but a worker that learns the shape only
 * from a rejection has already spent the turn that wrote the wrong thing. Stating the schema, the
 * ceiling and the spill path up front is what makes the enforcement cheap.
 */
export function buildForemanReportSection(cli: string): string {
  const fields = Object.keys(ForemanReportSchema.shape).join(', ')
  return `

=== REPORT (ORCHESTRATED RUN) ===
This run is orchestrated: a lead reads your report into its own context, so the report is
schema-bounded and capped. Send \`--type worker_done\` with \`--orchestrated\` and a JSON
\`--body\` matching the Foreman report schema:

\`\`\`json
{
  "status": "done | blocked | needs_decision | failed",
  "summary": "<at most three sentences: what you did, what you found, what is left>",
  "changes": [{ "repo": "<name>", "path": "<path>", "kind": "added|modified|deleted|renamed", "why": "<half a line>" }],
  "interface_delta": [{ "kind": "http_endpoint|type|event|schema|cli", "name": "<name>", "shape": "<signature>", "breaking": false }],
  "verification": { "command": "<exact command>", "result": "passed|failed|not_run", "evidence": "<one line>" },
  "open_questions": ["<only things that genuinely block>"],
  "artifacts": ["<path to anything too long for this report>"],
  "cost": { "tokens_in": null, "tokens_out": null }
}
\`\`\`

Rules the schema enforces, so writing past them costs you a turn:
  # Every field above is required: ${fields}.
  # \`summary\` is counted, not trusted — at most three sentences.
  # \`changes\` carries paths only, never file contents.
  # \`interface_delta\` is the ONLY thing that crosses to another subagent. Put a contract here
  #   and nowhere else; never paste another subagent's transcript or reasoning.
  # \`result: "not_run"\` is not \`"passed"\`. A subagent that could not verify says so.
  # The whole body is capped at ~${FOREMAN_REPORT_MAX_TOKENS} tokens. Over the cap, the CLI writes
  #   the report to \`.foreman/<run-id>/<dispatch-id>-report.md\` and returns that path — do not
  #   also pass \`--report-path\`, or the report would point at one file while another is written.

\`${cli} orchestration send\` sets \`${ALICORN_STRATEGY_ENV}=orchestrated\` for you when the run is
orchestrated; pass \`--orchestrated\` explicitly if you are unsure.

---`
}

/**
 * What a lead is told about the journal.
 *
 * A lead's context is a cache of the journal, not the other way round — so the instruction is to
 * write first and rely on it second. The coordinator writes node status into the same file, which
 * is why the lead is told which columns are not its own.
 */
export function buildForemanJournalSection(runId: string): string {
  return `

=== JOURNAL ===
You are the lead for this run. You write no code and read no implementation: your job is to plan,
dispatch, and re-plan from what comes back.

The journal at \`.foreman/${runId}/journal.md\` is the source of truth for this run, and your
context is a cache of it. Keep it current as you go — not at the end:

  # Decisions — what you chose, why, and whether it is reversible.
  # Assumptions made without asking — with the blast radius and which nodes depend on each, so
  #   reversing one re-dispatches only those nodes.
  # Contract registry — the typed interfaces later nodes build against. This is what you paste into
  #   a brief; never paste a subagent's transcript.
  # Not done — anything you decided to skip, so it is not mistaken for finished.

Orca writes the plan table's Status and Dispatch columns for you as nodes dispatch and settle.
Title, Owner, Depends on, Model and Files are yours: fill them when you plan a node, and Orca will
not overwrite them.

=== CONTRACT REGISTRY ===
Orca fills the registry's tables for you: extracted from the repo's OpenAPI documents and shared
contract types at run start, then one row per \`interface_delta\` as each node settles. Paste a row
into a brief instead of telling a subagent an interface in prose — one row is about 200 tokens and
it does not drift.

Read the **Provenance** column before you trust a row. \`extracted\` came out of a schema;
\`⚠ agent-declared\` is a subagent's word for it and is only as good as that subagent. An extracted
row is never overwritten by a declared one.

A repo under **Schema generation required** has no schema Orca could read. That is not a repo with
no interfaces — it is a repo where every contract is somebody's assertion. If the run depends on one
of its interfaces, dispatch a node to generate what that row asks for before you build against it.

=== WAVES ===
Declare each node's **Files** — the paths you intend it to touch. Two nodes with no edge between
them look parallel, but if they declare the same file they never were: Orca serialises them into
successive waves, journals the overlap in the Waves section, and holds the later node until the
earlier one settles. An undeclared overlap is found at the merge instead.

When every node of a wave has settled, a code step folds their reports into one table at
\`.foreman/${runId}/wave-<n>.md\` and records the path in the Waves section. **Read that table, not
the reports.** Each report is bounded; N of them in your window is not, and reading the wave one
row per node is what keeps this run inside its context. Open a single report only when the table
sends you to one.

If your context reaches its ceiling you will be told to bring the journal up to date and compact.
After compacting, work from the journal alone — if something was not worth writing down, it was not
worth carrying.

---`
}
