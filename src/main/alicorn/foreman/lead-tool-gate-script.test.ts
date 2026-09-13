import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALICORN_LEAD_TOOL_GATE_PATHNAME,
  ALICORN_ROLE_ENV_VAR,
  getLeadToolGateScript
} from './lead-tool-gate-script'

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getLeadToolGateScript (POSIX)', () => {
  const script = getLeadToolGateScript('posix')

  it('posts the payload to the gate endpoint', () => {
    expect(script).toContain(ALICORN_LEAD_TOOL_GATE_PATHNAME)
    expect(script).toContain('--data-binary @-')
  })

  // Why: empty stdout fails closed in Claude (#14818), so every branch must print exactly once —
  // a decision when there is one, neutral JSON otherwise.
  it('prints neutral JSON on every path that has no decision', () => {
    expect(script.match(/printf '\{\}\\n'/g)).toHaveLength(2)
    expect(script).toContain("'{'*) printf '%s\\n' \"$orca_lead_gate\"")
  })

  it('answers without spawning curl when the pane is not a lead', () => {
    expect(script).toContain(`if [ -z "\${${ALICORN_ROLE_ENV_VAR}:-}" ]`)
  })

  // Why: a stale port after an Alicorn restart would fail open and leave the lead unrestricted.
  it('refreshes the endpoint coordinates first', () => {
    expect(script.indexOf('ALICORN_AGENT_HOOK_ENDPOINT')).toBeLessThan(script.indexOf('curl'))
  })

  it('sends the cwd, which is the worktree the lead must not read', () => {
    expect(script).toContain('-H "X-Orca-Cwd: ${PWD:-}"')
  })

  // Why (#8110): the shared capture idiom, before anything that can exit — a hook that exits
  // mid-write leaves the agent with a broken pipe.
  it('captures stdin before any exit', () => {
    expect(script).toContain('payload=$({ command -p cat 2>/dev/null || cat; })')
    expect(script.indexOf('payload=$(')).toBeLessThan(script.indexOf('exit 0'))
  })

  it('sends the captured payload rather than re-reading stdin', () => {
    expect(script).toContain('printf %s "$payload" | curl')
  })
})

describe('getLeadToolGateScript (Windows)', () => {
  it('captures the response in a file rather than a subshell pipe', () => {
    withPlatform('win32', () => {
      const script = getLeadToolGateScript('local')

      expect(script).toContain('curl.exe')
      expect(script).toContain('-o "%ALICORN_LEAD_GATE_OUT%"')
      expect(script).not.toContain('for /f')
      expect(script).toContain('del /f /q "%ALICORN_LEAD_GATE_OUT%"')
    })
  })

  it('answers neutrally on every path that has no decision', () => {
    withPlatform('win32', () => {
      const script = getLeadToolGateScript('local')

      expect(script).toContain('(echo {})')
      expect(script).toContain(':orca_lead_gate_neutral')
      expect(script).toContain(':orca_lead_gate_drain')
    })
  })

  // Why (#11549): outside an Alicorn pane the caller may abandon stdin, so the env guards must come
  // before anything that reads it.
  it('checks the Alicorn env before it owns stdin', () => {
    withPlatform('win32', () => {
      const script = getLeadToolGateScript('local')

      expect(script.indexOf('ALICORN_AGENT_HOOK_PORT%"==""')).toBeLessThan(
        script.indexOf('curl.exe')
      )
      expect(script.indexOf('more.com')).toBeGreaterThan(script.indexOf('curl.exe'))
    })
  })
})
