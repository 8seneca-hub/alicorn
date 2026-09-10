import { z } from 'zod'
import { type AuthConfig, parseAuthConfig } from '@alicorn-cloud/control-plane-auth'
import {
  readProvenanceExportSigningKey,
  type ProvenanceExportSigningKey
} from '@alicorn-cloud/control-plane-contract'
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8082),
  ALICORN_DATABASE_URL: z.string().min(1),
  ALICORN_DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]*$/).default('ledger'),
  ALICORN_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  // PV2. An EC P-256 private key in PEM. Absent means the export route refuses (503) rather than
  // serving an unsigned artefact. Never logged, never echoed — only the public JWK leaves the process.
  // Why not .min(1): docker compose interpolates an unset variable to the empty string, and an
  // empty PEM must read as "no key configured", not as a boot failure.
  ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM: z.string().optional(),
  // Optional. Defaults to the key's RFC 7638 thumbprint, which rotates with the key on its own.
  // Why not .min(1): the same compose hazard as the PEM above — an unset variable arrives as the
  // empty string, and an empty key id must read as "not set" so the thumbprint default applies,
  // not as a boot failure that keeps the whole service down.
  ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID: z.string().max(200).optional()
})
export type LedgerApiConfig = {
  port: number
  databaseUrl: string
  databaseSchema: string
  poolMax: number
  auth: AuthConfig
  exportSigningKey?: ProvenanceExportSigningKey
}
export function loadLedgerApiConfig(env: NodeJS.ProcessEnv = process.env): LedgerApiConfig {
  const p = EnvSchema.parse(env)
  return {
    port: p.PORT,
    databaseUrl: p.ALICORN_DATABASE_URL,
    databaseSchema: p.ALICORN_DATABASE_SCHEMA,
    poolMax: p.ALICORN_DATABASE_POOL_MAX,
    auth: parseAuthConfig(env),
    exportSigningKey: p.ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM?.trim()
      ? readProvenanceExportSigningKey(p.ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM, {
          keyId: p.ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID?.trim() || undefined
        })
      : undefined
  }
}
