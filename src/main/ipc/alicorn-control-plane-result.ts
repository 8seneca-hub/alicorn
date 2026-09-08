import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../alicorn/control-plane-http'

export type AlicornFailure = { ok: false; error: string }

const UNCONFIGURED: AlicornFailure = { ok: false, error: 'control_plane_unconfigured' }

/**
 * A control-plane failure is a result the renderer can render, not a rejected invoke: the Members
 * pane has to say *why* it is empty. An error that is neither shape still throws — a bug must not
 * be disguised as a refusal.
 */
export async function attemptControlPlane<T extends object>(
  client: ControlPlaneClient | null,
  run: (client: ControlPlaneClient) => Promise<T>
): Promise<T | AlicornFailure> {
  if (!client) {
    return UNCONFIGURED
  }
  try {
    return await run(client)
  } catch (error) {
    if (error instanceof ControlPlaneUnavailableError) {
      return { ok: false, error: error.code }
    }
    if (error instanceof ControlPlaneRequestError) {
      return { ok: false, error: error.code }
    }
    throw error
  }
}

/** Shallow guard: the control plane validates the full shape, this only rejects obvious junk. */
export function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
