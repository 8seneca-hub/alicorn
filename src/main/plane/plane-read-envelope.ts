import type { PlaneResult } from '../../shared/plane-types'
import { getActiveClient, getClientById } from './plane-connection'
import type { PlaneClient } from './plane-request'

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Every read is wrapped so a transport or credential failure reaches the caller
// as a message it can show, not an unhandled rejection across IPC or RPC.
export async function attempt<T>(run: () => Promise<T> | T): Promise<PlaneResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

// A read names its connection explicitly or falls back to the active one, so a
// list started before a connection switch cannot resolve against the new key.
export function resolveClient(connectionId: unknown): PlaneClient | null {
  const id = optionalString(connectionId)
  return id ? getClientById(id) : getActiveClient()
}

export async function withClient<T>(
  connectionId: unknown,
  run: (client: PlaneClient) => Promise<T>
): Promise<PlaneResult<T>> {
  const client = resolveClient(connectionId)
  if (!client) {
    return { ok: false, error: 'No Plane workspace is connected.' }
  }
  return attempt(() => run(client))
}
