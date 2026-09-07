import type { IncomingHttpHeaders } from 'node:http'
import {
  evaluateLeadToolUse,
  leadToolUseFromPreToolUsePayload,
  type LeadToolDecision
} from './lead-tool-policy'

/**
 * A `PreToolUse` deny, in both spellings Claude accepts. Emitting the pair is deliberate: the
 * shape a given build honours is not something a gate can afford to guess wrong.
 */
export type LeadToolGateResponse = {
  decision: 'block'
  reason: string
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.trim() ? first.trim() : undefined
}

function buildDenyResponse(decision: LeadToolDecision): LeadToolGateResponse {
  return {
    decision: 'block',
    reason: decision.reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason
    }
  }
}

/**
 * Answers a lead pane's `PreToolUse` hook. Null means no decision, which the script prints as `{}`
 * and the agent reads as "carry on".
 *
 * Everything unrecognised fails open, for the same reason the status endpoint does: this runs
 * before every tool call a lead makes, and a gate that blocks on its own confusion would strand
 * the run. What keeps that honest is that the request only ever comes from a pane launched with
 * `ALICORN_ROLE`, and the write half is refused at launch besides.
 */
export function evaluateLeadToolGateRequest(
  body: unknown,
  headers: IncomingHttpHeaders = {}
): LeadToolGateResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }
  const payload = body as Record<string, unknown>
  const eventName = payload.hook_event_name ?? payload.hookEventName
  // Absent is accepted — only this hook calls this endpoint — but a different event is not.
  if (eventName !== undefined && eventName !== 'PreToolUse') {
    return null
  }
  // The worktree is what the lead must not read, so no worktree means no decision to make.
  const worktreePath =
    (typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined) ??
    readHeader(headers, 'x-alicorn-cwd')
  if (!worktreePath) {
    return null
  }
  const use = leadToolUseFromPreToolUsePayload(payload, worktreePath)
  if (!use) {
    return null
  }
  const decision = evaluateLeadToolUse(use)
  return decision ? buildDenyResponse(decision) : null
}
