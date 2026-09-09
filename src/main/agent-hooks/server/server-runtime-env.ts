import { join } from 'node:path'
import {
  getEndpointFileName,
  writeEndpointFile
} from '../../../shared/agent-hook-listener/endpoint-publication'
import {
  ALICORN_HOOK_PROTOCOL_VERSION,
  ALICORN_HOOK_RAW_JSON_TRANSPORT
} from '../../../shared/agent-hook-types'
import { withLegacyEnvAliases } from '../../../shared/alicorn-env-compat'
import { AgentHookServerIngestRemote } from './server-ingest-remote'

export abstract class AgentHookServerRuntimeEnv extends AgentHookServerIngestRemote {
  buildPtyEnv(): Record<string, string> {
    if (this.port <= 0 || !this.token) {
      return {}
    }
    const env: Record<string, string> = {
      ALICORN_AGENT_HOOK_PORT: String(this.port),
      ALICORN_AGENT_HOOK_TOKEN: this.token,
      ALICORN_AGENT_HOOK_ENV: this.env,
      ALICORN_AGENT_HOOK_VERSION: ALICORN_HOOK_PROTOCOL_VERSION,
      ALICORN_AGENT_HOOK_TRANSPORT: ALICORN_HOOK_RAW_JSON_TRANSPORT
    }
    // Why: hooks source this file at invocation; dev namespaces it so parallel `pnpm dev` runs don't steal each other's hooks.
    if (this.endpointFileWritten && this.endpointFilePathCache) {
      env.ALICORN_AGENT_HOOK_ENDPOINT = this.endpointFilePathCache
    }
    // Why: a managed hook script installed by the previous release reads the pre-rebrand names.
    return withLegacyEnvAliases(env)
  }

  get endpointFilePath(): string | null {
    return this.endpointFilePathCache
  }

  /** Test/diagnostic accessor for the on-disk last-status file path. */
  get lastStatusPath(): string | null {
    return this.lastStatusFilePath
  }

  protected maybeWriteEndpointFile(): void {
    if (!this.endpointDir || !this.endpointFilePathCache) {
      return
    }
    this.endpointFileWritten = false
    const ok = writeEndpointFile(this.endpointDir, this.endpointFilePathCache, {
      port: this.port,
      token: this.token,
      env: this.env,
      version: ALICORN_HOOK_PROTOCOL_VERSION,
      transport: ALICORN_HOOK_RAW_JSON_TRANSPORT
    })
    this.endpointFileWritten = ok
  }

  protected configureEndpointPaths(userDataPath: string, endpointNamespace?: string): void {
    // Why: dev builds share one userData path; namespace per instance while packaged keeps the stable path for PTY reconnect.
    this.endpointDir = endpointNamespace
      ? join(userDataPath, 'agent-hooks', endpointNamespace)
      : join(userDataPath, 'agent-hooks')
    this.endpointFilePathCache = join(this.endpointDir, getEndpointFileName())
    this.lastStatusFilePath = join(this.endpointDir, 'last-status.json')
  }
}
