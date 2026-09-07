import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ForemanReportSchema, fitReportBody } from '../../../shared/alicorn/foreman-report'
import { RuntimeClientError } from '../../runtime-client'

// Stamped into the worker environment when the run's strategy is orchestrated, so a worker that was
// never told it is part of an orchestrated run is not held to the report schema.
export const ALICORN_STRATEGY_ENV = 'ORCA_ALICORN_STRATEGY'

export function isOrchestratedWorker(
  flags: Map<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return flags.get('orchestrated') === true || env[ALICORN_STRATEGY_ENV] === 'orchestrated'
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

export function spillPathFor(cwd: string, runId: string, dispatchId: string): string {
  return join(cwd, '.foreman', runId, `${dispatchId}-report.md`)
}

function writeSpillFile(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return path
}

// `body` stays `string | undefined` on the way out: a single-agent worker_done with no body must
// still send `undefined`, not an empty string, or the runtime sees a body where there was none.
export type ReportCeilingResult = {
  body: string | undefined
  spilled: boolean
  reportPath?: string
}

export type ReportCeilingInput = {
  body: string | undefined
  flags: Map<string, string | boolean>
  cwd: string
  runId: string
  dispatchId: string
  reportPath: string | undefined
  env?: NodeJS.ProcessEnv
  writeSpill?: (path: string, content: string) => string
}

/**
 * Validates and bounds a `worker_done` body on an orchestrated run.
 *
 * Free text still passes on a single-agent run: `single` is the default and stays the default, so
 * the schema is a cost only the runs that need it pay.
 */
export function applyWorkerDoneReportCeiling(input: ReportCeilingInput): ReportCeilingResult {
  if (!isOrchestratedWorker(input.flags, input.env ?? process.env)) {
    return { body: input.body, spilled: false }
  }

  const body = input.body ?? ''

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(body) as unknown
  } catch {
    throw new RuntimeClientError(
      'invalid_report',
      'An orchestrated run reports as JSON matching the Foreman report schema.'
    )
  }

  const parsed = ForemanReportSchema.safeParse(parsedBody)
  if (!parsed.success) {
    throw new RuntimeClientError('invalid_report', describeIssues(parsed.error))
  }

  // Why refuse rather than pick one: --report-path already names where the detail lives, and
  // spilling would silently write a second file that the report does not point at.
  const path = spillPathFor(input.cwd, input.runId, input.dispatchId)
  const write = input.writeSpill ?? writeSpillFile
  return fitReportBody(body, {
    writeSpill: (content) => {
      if (input.reportPath) {
        throw new RuntimeClientError(
          'report_ambiguous',
          'This report is over the ceiling and --report-path is already set. Shorten the report or drop --report-path.'
        )
      }
      return write(path, content)
    }
  })
}
