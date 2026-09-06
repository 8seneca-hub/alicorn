import { z } from 'zod'
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8082),
  ALICORN_DATABASE_URL: z.string().min(1),
  ALICORN_DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]*$/).default('ledger'),
  ALICORN_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  // Why: identity is deferred; `local` is the only mode until the Keycloak plan adds `keycloak`.
  ALICORN_AUTH_MODE: z.enum(['local']).default('local'),
  ALICORN_TENANT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('local'),
  ALICORN_LOCAL_API_TOKEN: z.string().min(16)
})
export type LedgerApiConfig = {
  port: number
  databaseUrl: string
  databaseSchema: string
  poolMax: number
  authMode: 'local'
  tenantId: string
  localApiToken: string
}
export function loadLedgerApiConfig(env: NodeJS.ProcessEnv = process.env): LedgerApiConfig {
  const p = EnvSchema.parse(env)
  return {
    port: p.PORT,
    databaseUrl: p.ALICORN_DATABASE_URL,
    databaseSchema: p.ALICORN_DATABASE_SCHEMA,
    poolMax: p.ALICORN_DATABASE_POOL_MAX,
    authMode: p.ALICORN_AUTH_MODE,
    tenantId: p.ALICORN_TENANT_ID,
    localApiToken: p.ALICORN_LOCAL_API_TOKEN
  }
}
