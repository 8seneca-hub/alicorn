import type { IncomingHttpHeaders } from 'node:http'
import { parseAlicornPaneRole } from './agent-pane-role'
import {
  buildToolGateDenyResponse,
  evaluateLeadToolGateRequest,
  type LeadToolGateResponse
} from './foreman/lead-tool-gate-request'
import { recordQaSandboxDenial } from './qa-sandbox/qa-sandbox-denial-log'
import { qaToolUseFromPreToolUsePayload } from './qa-sandbox/qa-tool-gate-payload'
import { evaluateQaToolUse, type QaToolDecision } from './qa-sandbox/qa-tool-policy'
import type { QaPathFs } from './qa-sandbox/qa-workspace-path'

export type AgentToolGateResponse = LeadToolGateResponse

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.trim() ? first.trim() : undefined
}

/**
 * The one `PreToolUse` endpoint both restricted roles answer on, dispatched by the role the pane
 * was launched with. One endpoint because the transport — script, hook entry, token, cwd header —
 * is identical for both, and a second copy of it is a second thing to keep in step.
 *
 * An unrecognised or absent role falls through to the lead policy, which is what this endpoint did
 * before QA existed. That is the conservative branch, not a shrug: the lead policy denies more of
 * the worktree than QA's does, and the role header comes from the pane's launch env, which the
 * agent cannot rewrite.
 */
export function evaluateAgentToolGateRequest(
  body: unknown,
  headers: IncomingHttpHeaders = {},
  deps: { fs?: QaPathFs } = {}
): AgentToolGateResponse | null {
  if (parseAlicornPaneRole(readHeader(headers, 'x-alicorn-role')) !== 'qa') {
    return evaluateLeadToolGateRequest(body, headers)
  }
  const decision = decideForQaPane(body, headers, deps.fs)
  if (!decision) {
    return null
  }
  recordQaSandboxDenial(decision)
  return buildToolGateDenyResponse(decision)
}

/**
 * Every unreadable answer here is a block, where the lead branch shrugs. The asymmetry is the
 * point: a lead that reads on has seen code it should not have, whereas a QA member that reads on
 * has invalidated the tests it is about to write, and nothing downstream can tell.
 */
function decideForQaPane(
  body: unknown,
  headers: IncomingHttpHeaders,
  fs: QaPathFs | undefined
): (QaToolDecision & { toolName: string; workspacePath: string }) | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      decision: 'block',
      toolName: 'unknown',
      workspacePath: '',
      reason: 'The QA sandbox refused a tool call it could not read.'
    }
  }
  const payload = body as Record<string, unknown>
  const eventName = payload.hook_event_name ?? payload.hookEventName
  // Only `PreToolUse` carries a decision; a different event has nothing to answer.
  if (eventName !== undefined && eventName !== 'PreToolUse') {
    return null
  }
  const workspacePath =
    (typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined) ??
    readHeader(headers, 'x-alicorn-cwd') ??
    ''
  const use = qaToolUseFromPreToolUsePayload(payload, workspacePath)
  if (!use) {
    return {
      decision: 'block',
      toolName: 'unknown',
      workspacePath,
      reason: 'The QA sandbox refused a tool call that named no tool.'
    }
  }
  if (!workspacePath) {
    return {
      decision: 'block',
      toolName: use.toolName,
      workspacePath,
      reason: `${use.toolName} was refused: the QA sandbox cannot be evaluated because the pane reported no working directory.`
    }
  }
  const decision = evaluateQaToolUse(use, fs)
  return decision ? { ...decision, toolName: use.toolName, workspacePath } : null
}
