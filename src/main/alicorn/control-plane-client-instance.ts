import { createControlPlaneClient, type ControlPlaneClient } from './control-plane-client'

// One instance for the whole main process. B1's alicornFetch reads the
// environment on every call, so there is no configuration to plumb through and
// nothing to rebuild when the env changes.
let client: ControlPlaneClient | null = null

export function getControlPlaneClient(): ControlPlaneClient {
  client ??= createControlPlaneClient()
  return client
}

export function setControlPlaneClientForTests(replacement: ControlPlaneClient | null): void {
  client = replacement
}
