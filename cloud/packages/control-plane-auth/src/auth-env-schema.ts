import { z } from 'zod'

export const authEnvSchema = z.object({
  ALICORN_AUTH_MODE: z.enum(['local', 'keycloak']).default('local'),
  ALICORN_TENANT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('local'),
  ALICORN_LOCAL_API_TOKEN: z.string().min(16).optional(),
  ALICORN_KEYCLOAK_ISSUER: z.string().url().optional(),
  ALICORN_KEYCLOAK_INTERNAL_ISSUER: z.string().url().optional(),
  ALICORN_DESKTOP_CLIENT_ID: z.string().min(1).default('alicorn-desktop'),
  // Why: JWKS over plaintext to a non-loopback host is an opt-in, so a misconfigured
  // production deployment fails loudly instead of trusting keys from an unauthenticated hop.
  ALICORN_KEYCLOAK_ALLOW_INSECURE_JWKS: z.enum(['true', 'false']).default('false')
})

export type AuthConfig =
  | { authMode: 'local'; tenantId: string; localApiToken: string }
  | { authMode: 'keycloak'; issuer: string; internalIssuer: string; clientId: string; allowInsecureJwks: boolean }

// Why: trailing '/' on an issuer breaks exact string comparison against a JWT's `iss` claim.
function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const p = authEnvSchema.parse(env)
  if (p.ALICORN_AUTH_MODE === 'local') {
    if (!p.ALICORN_LOCAL_API_TOKEN) throw new Error('ALICORN_LOCAL_API_TOKEN required in local mode')
    return { authMode: 'local', tenantId: p.ALICORN_TENANT_ID, localApiToken: p.ALICORN_LOCAL_API_TOKEN }
  }
  if (!p.ALICORN_KEYCLOAK_ISSUER) throw new Error('ALICORN_KEYCLOAK_ISSUER required in keycloak mode')
  return {
    authMode: 'keycloak',
    issuer: stripTrailingSlash(p.ALICORN_KEYCLOAK_ISSUER),
    internalIssuer: stripTrailingSlash(p.ALICORN_KEYCLOAK_INTERNAL_ISSUER ?? p.ALICORN_KEYCLOAK_ISSUER),
    clientId: p.ALICORN_DESKTOP_CLIENT_ID,
    allowInsecureJwks: p.ALICORN_KEYCLOAK_ALLOW_INSECURE_JWKS === 'true'
  }
}
