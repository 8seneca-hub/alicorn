import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { OrchestrationDb } from '../runtime/orchestration/db'

// Why: mirrors CONTEXT_CAPTURE_MAX_PROMPT_BYTES in the wire contract. A prompt over the cap is
// rejected by the Ledger API, so it is spilled to a file here rather than truncated — the whole
// point of the capture is telling an underinformed member from a wrong one.
const MAX_INLINE_PROMPT_BYTES = 64 * 1024

export type ContextCaptureInput = {
  runId: string
  taskId: string
  dispatchId: string
  prompt: string
  contextSlice: Record<string, unknown>
}

function defaultWritePromptFile(dispatchId: string, prompt: string): string {
  const directory = join(app.getPath('userData'), 'alicorn', 'context-captures')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${dispatchId}.md`)
  writeFileSync(path, prompt, 'utf-8')
  return path
}

/**
 * Records the exact prompt and context slice a dispatch was given, through the outbox.
 *
 * Never throws: a capture is telemetry, and must never be the reason a dispatch fails. The outbox's
 * dedupe key makes it exactly-once per dispatch, so a retried dispatch — which gets a new
 * dispatch id — is a new capture rather than a duplicate.
 */
export function enqueueContextCapture(
  db: OrchestrationDb,
  input: ContextCaptureInput,
  deps: { writePromptFile?: (dispatchId: string, prompt: string) => string } = {}
): void {
  const writePromptFile = deps.writePromptFile ?? defaultWritePromptFile
  try {
    const oversized = Buffer.byteLength(input.prompt, 'utf-8') > MAX_INLINE_PROMPT_BYTES
    const promptField = oversized
      ? { promptPath: writePromptFile(input.dispatchId, input.prompt) }
      : { prompt: input.prompt }
    db.enqueueLedgerOutbox({
      kind: 'context_capture',
      dedupeKey: `context_capture:${input.dispatchId}`,
      payload: {
        runId: input.runId,
        taskId: input.taskId,
        dispatchId: input.dispatchId,
        ...promptField,
        contextSlice: input.contextSlice
      }
    })
  } catch (error) {
    console.warn(
      '[alicorn] context capture skipped',
      input.dispatchId,
      error instanceof Error ? error.message : String(error)
    )
  }
}

type DispatchMember = { memberId: string; memberRole: string; backend: string } | undefined

// Why: a dispatch without a member (no --member flag) records no member fields at all rather than
// nulls, so a reader can tell "not launched as a member" from "member with no role".
export function memberContextSlice(member: DispatchMember): Record<string, unknown> {
  if (!member) {
    return {}
  }
  return { memberId: member.memberId, memberRole: member.memberRole, backend: member.backend }
}

type CaptureSiteRuntime = {
  getNestedWorkerMaxDepth: () => number
  getTerminalOrchestrationCliCommand: (handle: string) => string | undefined
}

// Why: the call-site adapter lives here rather than inline in the RPC method, which is already at
// its line budget. Structural parameter types keep this module off the runtime's type graph.
export function captureWorkerStartContext(
  db: OrchestrationDb,
  runtime: CaptureSiteRuntime,
  params: {
    from: string
    devMode?: boolean
    agent?: string | null
    model?: string | null
    effort?: string | null
  },
  task: { id: string; spec: string },
  dispatch: { id: string; depth: number },
  rest: { runId: string; terminalHandle: string; preamble: string }
): void {
  enqueueContextCapture(db, {
    runId: rest.runId,
    taskId: task.id,
    dispatchId: dispatch.id,
    prompt: rest.preamble,
    contextSlice: {
      taskSpec: task.spec,
      coordinatorHandle: params.from,
      workerHandle: rest.terminalHandle,
      depth: dispatch.depth,
      canDispatchSubWorkers: dispatch.depth < runtime.getNestedWorkerMaxDepth(),
      cliCommand: runtime.getTerminalOrchestrationCliCommand(rest.terminalHandle),
      devMode: params.devMode ?? false,
      agent: params.agent ?? null,
      model: params.model ?? null,
      effort: params.effort ?? null,
      ...memberContextSlice(db.getDispatchMember(dispatch.id))
    }
  })
}
