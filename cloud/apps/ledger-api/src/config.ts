import { z } from 'zod'
import { type AuthConfig, parseAuthConfig } from '@alicorn-cloud/control-plane-auth'
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8082),
  ALICORN_DATABASE_URL: z.string().min(1),
  ALICORN_DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]*$/).default('ledger'),
  ALICORN_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10)
})
export type LedgerApiConfig = {
  port: number
  databaseUrl: string
  databaseSchema: string
  poolMax: number
  auth: AuthConfig
}
export function loadLedgerApiConfig(env: NodeJS.ProcessEnv = process.env): LedgerApiConfig {
  const p = EnvSchema.parse(env)
  return {
    port: p.PORT,
    databaseUrl: p.ALICORN_DATABASE_URL,
    databaseSchema: p.ALICORN_DATABASE_SCHEMA,
    poolMax: p.ALICORN_DATABASE_POOL_MAX,
    auth: parseAuthConfig(env)
  }
}
