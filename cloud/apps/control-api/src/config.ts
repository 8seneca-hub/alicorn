import { z } from 'zod'
import { type AuthConfig, parseAuthConfig } from '@alicorn-cloud/control-plane-auth'
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8081),
  ALICORN_DATABASE_URL: z.string().min(1),
  ALICORN_DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]*$/).default('control'),
  ALICORN_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10)
})
export type ControlApiConfig = {
  port: number
  databaseUrl: string
  databaseSchema: string
  poolMax: number
  auth: AuthConfig
}
export function loadControlApiConfig(env: NodeJS.ProcessEnv = process.env): ControlApiConfig {
  const p = EnvSchema.parse(env)
  return {
    port: p.PORT,
    databaseUrl: p.ALICORN_DATABASE_URL,
    databaseSchema: p.ALICORN_DATABASE_SCHEMA,
    poolMax: p.ALICORN_DATABASE_POOL_MAX,
    auth: parseAuthConfig(env)
  }
}
