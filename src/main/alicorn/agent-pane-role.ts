/**
 * The roles Alicorn restricts at the tool boundary, and the variable that tells one pane from
 * another. Set at launch; absent on every ordinary session, which is what keeps the `PreToolUse`
 * hook from spawning anything for a pane that has nothing to decide.
 *
 * Declared here rather than beside either policy because the gate script, the hook installer and
 * both policies read it — three copies of this string would be three ways for the guard to go
 * quiet without anyone noticing.
 */
export const ALICORN_ROLE_ENV = 'ALICORN_ROLE'

export const ALICORN_PANE_ROLES = ['lead', 'qa'] as const

export type AlicornPaneRole = (typeof ALICORN_PANE_ROLES)[number]

export function parseAlicornPaneRole(value: string | undefined): AlicornPaneRole | null {
  const trimmed = value?.trim()
  return ALICORN_PANE_ROLES.find((role) => role === trimmed) ?? null
}

/**
 * What a restricted launch hands the terminal: the tools the runtime refuses at spawn, and the env
 * that makes the pane's `PreToolUse` gate answer. Kept out of the runtime's own contract so the
 * policy modules do not import the terminal layer to describe their own output.
 */
export type RestrictedPaneLaunch = {
  role: AlicornPaneRole
  restrictions: { disallowedTools?: string[]; env: Record<string, string> }
}
