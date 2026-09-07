import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'

/** Exit code reported for a stage the timeout killed, matching the shell convention. */
export const CODE_STAGE_TIMEOUT_EXIT = 124

export const CODE_STAGE_DEFAULT_TIMEOUT_MS = 600_000

// Why 4 KB: the tail goes into `step_outcomes.report_summary`, which the ledger reads and a human
// skims. A stage that prints a megabyte is not more explicable for it.
const TAIL_BYTES = 4 * 1024

export type CodeStageResult = {
  exitCode: number
  durationMs: number
  stdoutTail: string
  stderrTail: string
  timedOut: boolean
}

export type RunProcessFn = (spec: ProcessSpec) => Promise<ProcessResult>

function tail(value: string): string {
  return value.length <= TAIL_BYTES ? value : value.slice(-TAIL_BYTES)
}

/**
 * Runs a code stage's command in a workspace.
 *
 * A code stage exists so deterministic work — merge, rank, dedupe, format, generate — never touches
 * a model. Routing that through an agent is the most common waste the framework names, and it also
 * makes the result non-reproducible.
 *
 * The command goes through `runProcess`, never `child_process`: it pins `windowsHide`, refuses
 * `shell: true`, and encodes `.cmd`/`.bat` arguments so neither `CommandLineToArgvW` nor `cmd.exe`
 * mangles them. A ratchet test fails on any new direct import.
 */
export async function runCodeStage(input: {
  worktreePath: string
  command: string
  timeoutMs?: number
  exec?: RunProcessFn
}): Promise<CodeStageResult> {
  const exec = input.exec ?? runProcess
  const started = Date.now()
  // Why argv and not a shell string: `shell: true` is refused by runProcess, and splitting on
  // whitespace here would mangle a quoted path. The authored command is argv, space-separated.
  const [program, ...args] = input.command.trim().split(/\s+/)
  const result = await exec({
    program: program!,
    args,
    cwd: input.worktreePath,
    timeoutMs: input.timeoutMs ?? CODE_STAGE_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: TAIL_BYTES * 4
  })
  return {
    // Why 124 for a timeout and not null: an outcome has to be `succeeded` or `failed`, and a
    // killed stage is a failure with a recognisable code rather than an absent one.
    exitCode: result.timedOut ? CODE_STAGE_TIMEOUT_EXIT : (result.code ?? CODE_STAGE_TIMEOUT_EXIT),
    durationMs: Date.now() - started,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    timedOut: result.timedOut
  }
}

// Exit 0 is the only success. A code stage is deterministic, so anything else is a real failure
// rather than something to interpret.
export function codeStageOutcome(result: CodeStageResult): 'succeeded' | 'failed' {
  return result.exitCode === 0 ? 'succeeded' : 'failed'
}
