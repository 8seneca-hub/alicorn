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
  # Contract registry — the interface deltas from reports that later nodes build against. This is
  #   what you paste into a brief; never paste a subagent's transcript.
  # Not done — anything you decided to skip, so it is not mistaken for finished.

Orca writes the plan table's Status and Dispatch columns for you as nodes dispatch and settle.
Title, Owner, Depends on and Model are yours: fill them when you plan a node, and Orca will not
overwrite them.

If your context reaches its ceiling you will be told to bring the journal up to date and compact.
After compacting, work from the journal alone — if something was not worth writing down, it was not
worth carrying.

---`
}
