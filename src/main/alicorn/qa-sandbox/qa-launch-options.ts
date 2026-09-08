import { ALICORN_ROLE_ENV } from '../agent-pane-role'
import type { MemberBackend } from '../../../shared/alicorn/members'

export type QaLaunchOptions = { env: Record<string, string> }
export type QaLaunchUnsupported = { unsupported: true; reason: string }

/**
 * A QA member is blindfolded by its pane's `PreToolUse` gate, so a backend without one cannot host
 * it. Refusing is the point: launching anyway would give a QA member that reads the implementation
 * and tests written against it, and the run would look blindfolded while being nothing of the sort.
 *
 * No `disallowedTools` here, unlike a lead: QA writes tests, and the flag would be skipped anyway —
 * Orca launches Claude with `--dangerously-skip-permissions`. The hook is the whole enforcement.
 */
export function qaLaunchOptions(backend: MemberBackend): QaLaunchOptions | QaLaunchUnsupported {
  switch (backend) {
    case 'claude':
    case 'openclaude':
      return { env: { [ALICORN_ROLE_ENV]: 'qa' } }
    case 'codex':
    case 'grok':
      return {
        unsupported: true,
        reason: `${backend} cannot gate its own tool calls, so it cannot host a blindfolded QA member. Put the QA member on a Claude-backed model, or run the tests from a developer member and accept that QA read the implementation.`
      }
  }
}

export function isQaLaunchUnsupported(
  options: QaLaunchOptions | QaLaunchUnsupported
): options is QaLaunchUnsupported {
  return 'unsupported' in options
}
