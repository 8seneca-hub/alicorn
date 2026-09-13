# Identity — Keycloak auth mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tier-1 shared token with real identity: Keycloak 26 (organisations) in the local stack, the Control API brokering the desktop's _existing_ Orca Cloud sign-in flow, `requireTenant` gaining auth mode `keycloak` (tenant = Keycloak organisation id proven by the token), identity tables keyed by an internal `user_id`, relay tokens minted by the Control API, and the desktop's `readAlicornBearer` reading the signed-in session — with **no other desktop auth code changed**.

**Architecture:** One new workspace package `@alicorn-cloud/control-plane-auth` holds the auth seam both services share (`requireTenant` for modes `local` and `keycloak`, the JWKS verifier, the auth env schema) — the duplication threshold from tier-1 decision 7 is crossed the moment a verifier joins the middleware, so we consolidate once here. The Control API adds identity tables (`users`, `tenants`, `org_roles`, `cloud_profiles` — global, keyed by user, **not** tenant-scoped because one person belongs to several organisations), a thin Keycloak token client, the `/v1/desktop/auth/*` broker routes shaped exactly as `src/main/orca-profiles/profile-cloud-client.ts` parses, and relay-token minting. The desktop authorises straight against Keycloak (`ORCA_CLOUD_AUTHORIZE_URL`) and exchanges the code through the broker; the access token handed back is Keycloak's own JWT so the same verifier accepts it on every later request.

**Tech Stack:** Keycloak `quay.io/keycloak/keycloak:26.5.2` (Organizations GA), `jose ^6.1.3` (JWKS verify, ES256 sign — already a relay dependency), hono 4, `pg` 8, zod 3, vitest 4, Postgres 16. Desktop: Electron main only (`src/main/alicorn/control-plane-session.ts`).

**Spec:** `docs/alicorn/ARCHITECTURE.md` §5 (Identity), §6 (identity tables), §9; `docs/alicorn/ROADMAP.md` v0.1 _Identity_; `CLAUDE.md` → _Control plane: Postgres from day one — identity deferred_ (this plan lifts the deferral); research notes `research/identity.md` (local scratch). Plane: epic **F1** (ALC-28), items **I1–I5** (module _Identity_, owner Huy).

## Global Constraints

- **Keycloak 26+** with Organizations; realm `alicorn`; public PKCE client `alicorn-desktop`; `organization` is a _default_ client scope so the claim is always present without changing the desktop's requested scope (`openid profile email offline_access`).
- **Everything internal keys off `users.id`, never off the IdP subject** (ARCHITECTURE §5). The IdP subject appears only in `users.idp_subject`.
- **Tenant id = Keycloak organisation id.** `tenants.id` _is_ the org UUID, so it can be used directly as `tenant_id` on RLS'd rows with no lookup on the hot path. `x-alicorn-org` is **required** in keycloak mode and must be one of the token's organisations (403 `not_a_member` otherwise).
- **The access token returned to the desktop is Keycloak's access token, unmodified.** The Control API never mints user tokens; it mints only relay tokens (ES256, its own key).
- **Wire shapes are frozen by the desktop's normalizers**: `normalizeSessionResponse` / `normalizeCloudSummary` / `normalizeOrganizations` / `normalizeCapabilities` in `src/main/orca-profiles/profile-cloud-client.ts` throw on any missing required field. Responses must include every field in the _Wire contract_ table below.
- **Identity tables are global (no `tenant_id`, no RLS)**; every other product table stays tenant-scoped with forced RLS. Task 9 updates ARCHITECTURE §6 to say so.
- **Local mode keeps working unchanged** (`ALICORN_AUTH_MODE=local`, default). Mode is chosen per deployment; the two services must run the same mode.
- Alicorn-branded names (`@alicorn-cloud/*`, `ALICORN_*`); do not touch `ORCA_*` desktop constants (`PRODUCTION_API_BASE_URL`, `PRODUCTION_CLIENT_ID` are rebrand work).
- No AI attribution in commits. Cloud commands run from the worktree root as `env PATH=/Users/huy/.nvm/versions/node/v24.20.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin pnpm --dir cloud …`; Postgres tests need `ALICORN_TEST_POSTGRES_URL` (superuser URL — tests create their own non-superuser roles) and skip without it.

## Decisions made in this plan

1. **Consolidate the auth seam into `@alicorn-cloud/control-plane-auth`** (Task 1) before adding a second mode. Depends on `hono`, `jose`, `zod`. Both apps delete their `require-tenant.ts` copies.
2. **`AuthContext` grows to `{ tenantId, actor, userId: string | null }`.** Local mode: `actor` = `x-alicorn-actor` header or `'local'`, `userId: null`. Keycloak mode in the Control API: `userId` = internal `users.id` (401 `unknown_user` if the subject never went through `/session`), `actor = userId`. Ledger API has no identity tables: `userId: null`, `actor = claims.sub` (nothing in the ledger persists actor today; when it does, it will resolve through the Control API).
3. **Organisation claim parsing accepts both shapes Keycloak emits**: `{ "<alias>": { "id": "<uuid>", … } }` (preferred; Organization Membership mapper) and `["<alias>", …]` (aliases only). For the alias-only form the Control API resolves ids through `tenants.alias`; the ledger API — having no `tenants` table — rejects alias-only tokens with 403 `org_claim_unresolvable` (the realm import in Task 2 configures the mapper to emit ids, so this path is a guard, not the norm).
4. **`/v1/desktop/auth/authorize` is not implemented.** The desktop's `ORCA_CLOUD_AUTHORIZE_URL` points straight at Keycloak's `/realms/alicorn/protocol/openid-connect/auth`; the broker handles only the code exchange and everything after it.
5. **Refresh and capabilities pick the user's most recently selected profile** (`cloud_profiles.last_selected_at DESC`), because the desktop's `/refresh` body carries only `{ refreshToken }`. One profile per desktop install is the common case; `/profile` (multi-profile) stays **501** as in tier 1.
6. **Capabilities flags** returned to every signed-in user: `{ alicorn: true, 'relay.use': true }` — the desktop gates relay use on `relay.use` (`src/main/runtime/relay/relay-auth-context.ts:32`).
7. **First user to bring a tenant into `tenants` becomes its `owner`; later users are `member`.** Real role management is OP1 (v1.5).
8. **Relay tokens**: ES256, private key from `ALICORN_RELAY_SIGNING_JWK` (a JWK JSON string with `kid`), issuer `ALICORN_RELAY_TOKEN_ISSUER` (must equal the relay's `ORCA_RELAY_AUTH_ISSUER`), audience `orca-relay`, 15-minute expiry; public key served at `GET /.well-known/jwks.json` (the relay's `ORCA_RELAY_JWKS_URL`). Claims exactly as `cloud/apps/relay/src/relay-token-verifier.ts` requires: `{ sub, prof, org, relayHostId, purpose: 'host-control', exp }`.
9. **Keycloak's own database** lives in the same Postgres under role `keycloak` / schema `keycloak` (init SQL `02-keycloak-role.sql`). Org + dev-user membership are seeded through Keycloak's admin REST API by `seed-alicorn-local.mjs` (realm import cannot express membership portably).
10. **Desktop `readAlicornBearer` becomes async and two-mode** (Task 8): if `ALICORN_LOCAL_API_TOKEN` is set → local (unchanged behaviour); else read the Orca Cloud session (`readFreshOrcaCloudSession`) and the active org from the profile — exactly the pattern of `src/main/runtime/relay/relay-auth-context.ts`. The file belongs to the Members module (Nghia); OWNERSHIP.md carves out "the body of `readAlicornBearer` (I4)" for this plan — coordinate the day it lands.

## Wire contract the broker must satisfy (from `profile-cloud-client.ts`)

| Route                                         | Request body                                                        | Response (every field required unless `?`)                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/desktop/auth/session`               | `{ code, codeVerifier, nonce, redirectUri, state, localProfileId }` | `{ accessToken, refreshToken, expiresAt:number, cloud:{ cloudProfileId, userId, email, displayName?, activeOrgId?, activeOrgName?, linkedAt:number }, organizations?:[{ orgId, name, role? }], capabilities:{ flags:Record<string,boolean>, refreshedAt:number } }` |
| `POST /v1/desktop/auth/refresh`               | `{ refreshToken }`                                                  | same as session                                                                                                                                                                                                                                                     |
| `POST /v1/desktop/auth/capabilities` (bearer) | `{}`                                                                | `{ cloud?, organizations?, capabilities }`                                                                                                                                                                                                                          |
| `POST /v1/desktop/auth/org` (bearer)          | `{ orgId }`                                                         | `{ cloud, organizations?, capabilities }`                                                                                                                                                                                                                           |
| `POST /v1/desktop/auth/profile` (bearer)      | `{ orgId, name }`                                                   | **501** `{ error: 'not_implemented' }`                                                                                                                                                                                                                              |
| `POST /v1/desktop/auth/logout` (bearer)       | `{ refreshToken }`                                                  | 204                                                                                                                                                                                                                                                                 |
| `POST /v1/desktop/auth/relay-token` (bearer)  | `{ relayHostId, hostPublicKeyB64 }`                                 | `{ relayToken, expiresAt:number }` (desktop schema is `.strict()` — no extra fields)                                                                                                                                                                                |
| `GET /.well-known/jwks.json`                  | —                                                                   | `{ keys: [publicJwk] }`                                                                                                                                                                                                                                             |

## File structure

```
cloud/packages/control-plane-auth/                 @alicorn-cloud/control-plane-auth (hono + jose + zod)
  src/index.ts
  src/auth-context.ts                              AuthContext, AuthEnv<Name>, ControlPlaneAuthEnv
  src/auth-env-schema.ts                           authEnvSchema (zod fragment) + parseAuthConfig(env) → AuthConfig (local | keycloak)
  src/read-bearer.ts                               readBearer()
  src/keycloak-claims.ts                           KeycloakAccessClaimsSchema, organizationsFromClaim()
  src/keycloak-token-verifier.ts                   createKeycloakAccessTokenVerifier({ getKey, issuer, clientId })
  src/require-tenant.ts                            requireTenant(deps) — dispatches on deps.config.authMode
  src/test-keycloak.ts                             createTestKeycloak() — jose keypair + local JWKS + fake token endpoint (test-only export)
  src/*.test.ts
cloud/apps/control-api/src/
  config.ts                                        uses parseAuthConfig; keycloak env
  schema-sql.ts                                    + identity tables (global, no RLS)
  identity-repository.ts                           users/tenants/org_roles/cloud_profiles
  keycloak-token-client.ts                         exchangeCode / refresh / logout (fetch injectable)
  desktop-session-response.ts                      buildDesktopSessionResponse()
  desktop-auth-routes.ts                           /v1/desktop/auth/*
  relay-token-signer.ts                            createRelayTokenSigner({ jwk, issuer }) + jwks route
  app.ts                                           wires requireTenant(deps) (with lookupUserId), routes
cloud/apps/ledger-api/src/config.ts, app.ts        use the package; delete require-tenant.ts
cloud/packages/control-plane-postgres/src/tenant-transaction.ts   + withoutTenant (identity tables)
cloud/dev/compose/alicorn-local.yml                + keycloak service; ALICORN_AUTH_MODE default local, keycloak via env
cloud/dev/compose/postgres-init/02-keycloak-role.sql
cloud/dev/keycloak/alicorn-realm.json
cloud/dev/compose/desktop.env.example              keycloak-mode block
cloud/dev/scripts/seed-alicorn-local.mjs           + ensureOrganization / ensureMember (Keycloak admin API)
cloud/dev/scripts/generate-relay-signing-key.mjs
src/main/alicorn/control-plane-session.ts          readAlicornBearer async, two modes (I4)
docs/alicorn/ARCHITECTURE.md                       §5 status → built; §6 identity block → global tables
```

---

### Task 1 (I2-prep): Extract the auth seam into `@alicorn-cloud/control-plane-auth`

**Files:**

- Create: `cloud/packages/control-plane-auth/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `src/{index,auth-context,auth-env-schema,read-bearer,require-tenant}.ts`, `src/{require-tenant,auth-env-schema}.test.ts`
- Modify: `cloud/apps/control-api/src/{config.ts,app-env.ts,app.ts}`, `cloud/apps/ledger-api/src/{config.ts,app-env.ts,app.ts}`, both `package.json` (add `"@alicorn-cloud/control-plane-auth": "workspace:*"`, `pretest` builds it), `cloud/pnpm-lock.yaml`
- Delete: `cloud/apps/control-api/src/require-tenant.ts` + test, `cloud/apps/ledger-api/src/require-tenant.ts` + test

**Interfaces:**

- Produces:
  ```ts
  // auth-context.ts
  export type AuthContext = { tenantId: string; actor: string; userId: string | null }
  export type ControlPlaneAuthEnv = { Variables: { auth: AuthContext } }
  // auth-env-schema.ts
  export const authEnvSchema = z.object({
    ALICORN_AUTH_MODE: z.enum(['local', 'keycloak']).default('local'),
    ALICORN_TENANT_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .default('local'),
    ALICORN_LOCAL_API_TOKEN: z.string().min(16).optional(),
    ALICORN_KEYCLOAK_ISSUER: z.string().url().optional(),
    ALICORN_KEYCLOAK_INTERNAL_ISSUER: z.string().url().optional(),
    ALICORN_DESKTOP_CLIENT_ID: z.string().min(1).default('alicorn-desktop')
  })
  export type AuthConfig =
    | { authMode: 'local'; tenantId: string; localApiToken: string }
    | { authMode: 'keycloak'; issuer: string; internalIssuer: string; clientId: string }
  export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig // throws 'ALICORN_LOCAL_API_TOKEN required in local mode' / 'ALICORN_KEYCLOAK_ISSUER required in keycloak mode'; strips trailing '/' from issuers
  // require-tenant.ts (this task: local branch only; keycloak branch throws 'keycloak mode not implemented' until Task 4)
  export type RequireTenantDeps = {
    config: AuthConfig
    verifyAccessToken?: (token: string) => Promise<KeycloakAccessClaims | null>
    lookupUserId?: (idpSubject: string) => Promise<string | null>
    resolveOrgAliases?: (aliases: string[]) => Promise<Record<string, string>>
  }
  export function requireTenant(deps: RequireTenantDeps): MiddlewareHandler<ControlPlaneAuthEnv>
  export function readBearer(header: string | undefined): string | null
  ```
- Consumers: both apps' `config.ts` spread `authEnvSchema.shape` into their env schema (or call `parseAuthConfig(env)` and store `auth: AuthConfig` on the config); `app-env.ts` re-exports `AuthContext` and defines `ControlApiEnv = ControlPlaneAuthEnv`; `app.ts` uses `requireTenant({ config: deps.config.auth })`.

- [ ] **Step 1: Scaffold the package** — copy `cloud/packages/control-plane-postgres/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`; name `@alicorn-cloud/control-plane-auth`; dependencies `hono ^4.12.27`, `jose ^6.1.3`, `zod ^3.25.76`; vitest config without the Postgres serialization (plain `include: ['src/**/*.test.ts']`).
- [ ] **Step 2: Move the middleware** — `git mv cloud/apps/control-api/src/require-tenant.ts cloud/packages/control-plane-auth/src/require-tenant.ts` and its test; rewrite imports to `./auth-context.js`; change `deps.config` to the `AuthConfig` union with `if (deps.config.authMode === 'keycloak') throw new Error('keycloak mode not implemented')` at construction; add `userId: null` to the local branch's `c.set('auth', …)`. Delete the ledger-api copies.
- [ ] **Step 3: Failing tests** — `auth-env-schema.test.ts`: local mode without token → throws; keycloak mode without issuer → throws; trailing slash stripped; defaults. `require-tenant.test.ts`: the four existing local-mode cases plus `auth.userId === null`.
- [ ] **Step 4: Rewire both apps** — `config.ts`: `export type ControlApiConfig = { port; databaseUrl; databaseSchema; poolMax; auth: AuthConfig }`, `loadControlApiConfig` = existing env parsing + `auth: parseAuthConfig(env)`; update `config.test.ts` (`c.auth.authMode === 'local'`, `c.auth.tenantId === 'local'`). `app-env.ts`: `export type { AuthContext } from '@alicorn-cloud/control-plane-auth'; export type ControlApiEnv = ControlPlaneAuthEnv`. `app.ts`: `app.use('/v1/*', requireTenant({ config: deps.config.auth }))`. Same for ledger-api. Route files that read `c.get('auth').actor` are unchanged.
- [ ] **Step 5: Verify** — `pnpm --dir cloud install`; `pnpm --dir cloud -r build`; with `ALICORN_TEST_POSTGRES_URL` set: `pnpm --dir cloud --filter @alicorn-cloud/control-plane-auth test`, `--filter @alicorn-cloud/control-api test`, `--filter @alicorn-cloud/ledger-api test` all green (route tests unchanged); `pnpm --dir cloud typecheck`.
- [ ] **Step 6: Commit** — `refactor(cloud): extract the auth seam into @alicorn-cloud/control-plane-auth`.

---

### Task 2 (I1): Keycloak in the local stack

**Files:**

- Create: `cloud/dev/compose/postgres-init/02-keycloak-role.sql`, `cloud/dev/keycloak/alicorn-realm.json`, `cloud/dev/scripts/verify-keycloak-realm.mjs` (+ `.test.mjs`)
- Modify: `cloud/dev/compose/alicorn-local.yml`, `cloud/dev/compose/desktop.env.example`, `cloud/README.md`, `cloud/package.json` (add the verify test to the root `test` chain)

- [ ] **Step 1: Init SQL** `02-keycloak-role.sql`:
  ```sql
  CREATE ROLE keycloak LOGIN PASSWORD 'keycloak';
  GRANT CONNECT ON DATABASE alicorn TO keycloak;
  CREATE SCHEMA keycloak AUTHORIZATION keycloak;
  ```
- [ ] **Step 2: Compose service** (add to `alicorn-local.yml`):
  ```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.5.2
    command: ['start-dev', '--import-realm']
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${ALICORN_KEYCLOAK_ADMIN_PASSWORD:-admin}
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/alicorn
      KC_DB_SCHEMA: keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: keycloak
      # Why: `iss` in every token must equal what the desktop and the APIs are configured with.
      KC_HOSTNAME: http://127.0.0.1:8080
      KC_HTTP_ENABLED: 'true'
    ports: ['127.0.0.1:8080:8080']
    volumes: ['../keycloak:/opt/keycloak/data/import:ro']
    depends_on: { postgres: { condition: service_healthy } }
    healthcheck:
      {
        test:
          [
            'CMD-SHELL',
            "exec 3<>/dev/tcp/127.0.0.1/9000 && echo -e 'GET /health/ready HTTP/1.1\r\nhost: localhost\r\n\r\n' >&3 && grep -q '\"status\": \"UP\"' <&3"
          ],
        interval: 10s,
        timeout: 5s,
        retries: 30
      }
  ```
  and on both API services add `ALICORN_AUTH_MODE: ${ALICORN_AUTH_MODE:-local}`, `ALICORN_KEYCLOAK_ISSUER: http://127.0.0.1:8080/realms/alicorn`, `ALICORN_KEYCLOAK_INTERNAL_ISSUER: http://keycloak:8080/realms/alicorn`, `ALICORN_DESKTOP_CLIENT_ID: alicorn-desktop` (`KC_HEALTH_ENABLED: "true"` is required for the healthcheck; add it).
- [ ] **Step 3: Realm import** `cloud/dev/keycloak/alicorn-realm.json`:
  ```json
  {
    "realm": "alicorn",
    "enabled": true,
    "organizationsEnabled": true,
    "sslRequired": "none",
    "registrationAllowed": false,
    "accessTokenLifespan": 900,
    "ssoSessionIdleTimeout": 2592000,
    "offlineSessionIdleTimeout": 2592000,
    "clients": [
      {
        "clientId": "alicorn-desktop",
        "name": "Alicorn Desktop",
        "enabled": true,
        "publicClient": true,
        "protocol": "openid-connect",
        "standardFlowEnabled": true,
        "implicitFlowEnabled": false,
        "directAccessGrantsEnabled": false,
        "serviceAccountsEnabled": false,
        "redirectUris": ["http://127.0.0.1/*", "http://localhost/*"],
        "webOrigins": ["+"],
        "attributes": { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "+" },
        "defaultClientScopes": [
          "web-origins",
          "acr",
          "roles",
          "profile",
          "email",
          "basic",
          "organization"
        ],
        "optionalClientScopes": ["offline_access", "address", "phone", "microprofile-jwt"]
      }
    ],
    "users": [
      {
        "username": "dev",
        "email": "dev@alicorn.local",
        "emailVerified": true,
        "enabled": true,
        "firstName": "Dev",
        "lastName": "User",
        "credentials": [{ "type": "password", "value": "dev", "temporary": false }]
      }
    ]
  }
  ```
  Why `http://127.0.0.1/*` matches the desktop's random port: Keycloak retries a failed loopback match with the default port substituted (`RedirectUtils` loopback rule), so a registered loopback URI without a port matches any port. **Verify this by hand in Step 6** — if it fails, the fallback is `"http://127.0.0.1:*/auth/callback"`.
- [ ] **Step 4: Verify script** `verify-keycloak-realm.mjs` — exports `checkRealm(fetch, issuer, clientId)`: GETs `${issuer}/.well-known/openid-configuration`, asserts `issuer` equals the configured one, `authorization_endpoint`/`token_endpoint`/`jwks_uri`/`end_session_endpoint` present, `code_challenge_methods_supported` includes `S256`; then GETs `jwks_uri` and asserts ≥ 1 key. `main()` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`. Test with a stubbed `fetch` (happy path + missing S256 → throws). Add `"alicorn:verify-keycloak": "node dev/scripts/verify-keycloak-realm.mjs"` to `cloud/package.json`.
- [ ] **Step 5: Desktop env example** — append a _Keycloak mode_ block:
  ```bash
  # Keycloak mode (identity plan). Unset ALICORN_LOCAL_API_TOKEN when using this block.
  export ORCA_CLOUD_API_URL=http://127.0.0.1:8081
  export ORCA_CLOUD_CLIENT_ID=alicorn-desktop
  export ORCA_CLOUD_AUTHORIZE_URL=http://127.0.0.1:8080/realms/alicorn/protocol/openid-connect/auth
  export ALICORN_CONTROL_API_URL=http://127.0.0.1:8081
  export ALICORN_LEDGER_API_URL=http://127.0.0.1:8082
  ```
- [ ] **Step 6: Bring it up and prove by hand** — `ALICORN_AUTH_MODE=keycloak pnpm --dir cloud alicorn:up` (first Keycloak boot ≈ 60 s), `pnpm --dir cloud alicorn:verify-keycloak` passes; admin console at `http://127.0.0.1:8080` (`admin`/`admin`) shows realm `alicorn`, client `alicorn-desktop`, user `dev`. Loopback check: open `http://127.0.0.1:8080/realms/alicorn/protocol/openid-connect/auth?client_id=alicorn-desktop&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fauth%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256` — a login page (not "Invalid parameter: redirect_uri") proves the port-agnostic match. Record outcomes in the commit body. Tear down with `alicorn:down`.
- [ ] **Step 7: README** — _Alicorn control plane_ section gains "Keycloak mode" (how to switch, admin console, `alicorn:verify-keycloak`, `down -v` note applies to the new init SQL too).
- [ ] **Step 8: Commit** — `feat(cloud): Keycloak 26 in the local stack — realm import, desktop client, verify script`.

---

### Task 3 (I3): Identity tables and repository

**Files:**

- Modify: `cloud/packages/control-plane-postgres/src/tenant-transaction.ts` (+ `withoutTenant`), its Postgres test (+ one case), `cloud/apps/control-api/src/schema-sql.ts`
- Create: `cloud/apps/control-api/src/identity-repository.ts`, `src/identity-repository-postgres.test.ts`

**Interfaces:**

```ts
export function withoutTenant<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> // plain BEGIN/COMMIT, no set_config
// identity-repository.ts (all via withoutTenant)
export type IdentityUser = {
  id: string
  idpSubject: string
  email: string
  displayName: string | null
}
export type CloudProfileRow = {
  id: string
  userId: string
  name: string
  localProfileId: string | null
  activeTenantId: string | null
  lastSelectedAt: string
  createdAt: string
}
export type OrganizationMembership = { id: string; alias: string }
export function upsertUserFromClaims(
  pool,
  claims: { sub: string; email?: string; name?: string; preferred_username?: string }
): Promise<IdentityUser>
export function syncOrganizations(
  pool,
  userId: string,
  orgs: OrganizationMembership[]
): Promise<void> // upsert tenants(id, alias, name=alias); org_roles insert 'owner' if the tenant had no members, else 'member' (ON CONFLICT DO NOTHING); delete org_roles for this user not in orgs
export function listOrganizationsForUser(
  pool,
  userId
): Promise<Array<{ orgId: string; name: string; role: string }>>
export function resolveOrgAliases(pool, aliases: string[]): Promise<Record<string, string>> // alias → tenants.id
export function lookupUserIdBySubject(pool, idpSubject: string): Promise<string | null>
export function ensureCloudProfile(
  pool,
  input: { userId: string; localProfileId?: string }
): Promise<CloudProfileRow> // by (user_id, local_profile_id) else user's most recent else create 'Default'; active_tenant_id defaults to the user's first org (by tenants.alias)
export function getMostRecentCloudProfile(pool, userId): Promise<CloudProfileRow | null>
export function setActiveTenant(
  pool,
  input: { profileId: string; userId: string; tenantId: string }
): Promise<CloudProfileRow> // throws Error('not_a_member') unless org_roles has (tenantId, userId); bumps last_selected_at
```

Schema (append to `CONTROL_SCHEMA_STATEMENTS`, **no** `tenantRlsPolicySql` — identity tables are global):

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  idp_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS org_roles (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS cloud_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, local_profile_id TEXT,
  active_tenant_id TEXT REFERENCES tenants(id),
  last_selected_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS cloud_profiles_user_recent ON cloud_profiles(user_id, last_selected_at DESC);
```

- [ ] **Step 1: Failing tests** — postgres-package: `withoutTenant` runs with no `app.tenant_id` set (a `SELECT current_setting('app.tenant_id', true)` returns null). Control-api `identity-repository-postgres.test.ts` (harness as `members-routes-postgres.test.ts`; note identity tables are readable by the non-superuser role because they are not RLS'd): (1) upsert twice by subject → same id, display name updated; (2) `syncOrganizations` with `[{ id: 'org-acme', alias: 'acme' }]` → user is `owner`; a second user syncing the same org → `member`; removing an org from the list deletes that user's role only; (3) `resolveOrgAliases(['acme', 'nope'])` → `{ acme: 'org-acme' }`; (4) `ensureCloudProfile` idempotent per `localProfileId`, `activeTenantId === 'org-acme'`; (5) `setActiveTenant` to a non-member org throws `not_a_member`; to a member org bumps `last_selected_at` and `getMostRecentCloudProfile` returns it.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** with parameterised SQL (`INSERT … ON CONFLICT (idp_subject) DO UPDATE SET email = EXCLUDED.email, display_name = COALESCE(EXCLUDED.display_name, users.display_name) RETURNING *`; owner rule: `INSERT INTO org_roles … SELECT $1, $2, CASE WHEN EXISTS (SELECT 1 FROM org_roles WHERE tenant_id = $1) THEN 'member' ELSE 'owner' END ON CONFLICT DO NOTHING`; stale roles: `DELETE FROM org_roles WHERE user_id = $1 AND tenant_id <> ALL($2::text[])`). Schema test's forced-RLS list stays exactly `['member_skills','members','org_policies','project_required_checks']` — assert additionally that `users` has `relforcerowsecurity = false`.
- [x] **Step 4: Run → PASS**; `pnpm --dir cloud typecheck`. **Step 5: Commit** — `feat(control-api): identity tables and repository (users, tenants, org roles, cloud profiles)`.

**As built (2026-09-09).** Four differences from the sketch above, each deliberate:

1. **`org_roles` carries forced RLS**; `users`, `tenants` and `cloud_profiles` do not. The sketch
   left all four un-RLS'd, but CLAUDE.md's invariant is `tenant_id` on every tenant-scoped row
   _with forced RLS_, and "who is in this organisation" is the most sensitive row here. The price
   is that memberships can only be read or written inside their own tenant's scope, so the sketch's
   `listOrganizationsForUser` and its cross-tenant stale-role `DELETE` are neither possible nor
   built — and neither is needed, because organisations are always re-proven from the presented
   token (I2's rule) and a stale row can only under-grant. Reaping one is an operator sweep (OP1).
   The schema test's forced-RLS list therefore gained `org_roles` and nothing else.
2. **The seam is I2's `DesktopIdentityStore`, not a set of free functions.** I2 shipped the
   interface and the broker routes against it, so I3 is a second implementation
   (`postgres-desktop-identity-store.ts`) over `identity-repository.ts`; the in-process store
   survives as the broker tests' double. `upsertUserFromClaims`/`syncOrganizations`/
   `ensureCloudProfile`/`setActiveTenant` collapse into one `syncIdentity` transaction, because a
   half-synced identity is a user with no profile and the desktop reads that as a hijacked session.
3. **One cloud profile per user** (`user_id UNIQUE`), no `name` and no `last_selected_at`. Those
   exist in the sketch to pick a profile on `/refresh`; while `/profile` answers 501 the desktop
   cannot create a second one, so there is nothing to pick. Drop the UNIQUE and add
   `last_selected_at` when multi-profile actually lands.
4. **`withoutTenant` is `inTransaction` + `setTenantScope`.** The identity sync does set a tenant
   scope — one per organisation, inside a single transaction, which is what forced RLS on
   `org_roles` requires and what `withTenant` cannot express. `withoutTenant` would have named it
   wrongly.

Also: `users.idp_issuer` is recorded but is **not** part of the key. Keycloak's `sub` is a
per-realm UUID, so cross-realm collision is not a real hazard, whereas moving the realm's public
URL is ordinary — keying on it would sign every user out and orphan every row they own.

---

### Task 4 (I2a): Keycloak token verifier and `requireTenant` mode `keycloak`

**Files:**

- Create (package): `src/keycloak-claims.ts`, `src/keycloak-token-verifier.ts`, `src/test-keycloak.ts`, tests
- Modify (package): `src/require-tenant.ts` (keycloak branch), `src/index.ts`
- Modify (apps): `control-api/src/{index.ts,app.ts}` — build the verifier from config, pass `verifyAccessToken`, `lookupUserId: (sub) => lookupUserIdBySubject(pool, sub)`, `resolveOrgAliases: (a) => resolveOrgAliases(pool, a)`; `ledger-api/src/{index.ts,app.ts}` — verifier only (no lookups)

**Interfaces:**

```ts
// keycloak-claims.ts
export const KeycloakAccessClaimsSchema = z.object({
  sub: z.string().min(1),
  azp: z.string().min(1),
  exp: z.number().int().positive(),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  nonce: z.string().optional(),
  organization: z
    .union([
      z.record(z.object({ id: z.string().min(1) }).passthrough()),
      z.array(z.string().min(1))
    ])
    .optional()
})
export type KeycloakAccessClaims = z.infer<typeof KeycloakAccessClaimsSchema>
export type OrganizationMembership = { id: string; alias: string }
export type OrganizationClaim = { resolved: OrganizationMembership[]; unresolvedAliases: string[] }
export function organizationsFromClaim(
  claim: KeycloakAccessClaims['organization']
): OrganizationClaim
// keycloak-token-verifier.ts
export function createKeycloakAccessTokenVerifier(input: {
  getKey: JWTVerifyGetKey
  issuer: string
  clientId: string
}): (token: string) => Promise<KeycloakAccessClaims | null> // jwtVerify with issuer + algorithms ['RS256','ES256']; azp must equal clientId; null on any failure
// test-keycloak.ts (exported for consumers' tests too)
export async function createTestKeycloak(input: { issuer: string; clientId: string }): Promise<{
  getKey: JWTVerifyGetKey
  publicJwk: JWK
  sign(
    claims: Record<string, unknown>,
    opts?: { expiresIn?: string; audience?: string }
  ): Promise<string>
  startServer(): Promise<{ issuer: string; close(): Promise<void> }> // node:http serving /.well-known/openid-configuration, /protocol/openid-connect/certs, /protocol/openid-connect/token (returns tokens signed here; records requests), /protocol/openid-connect/logout
}>
```

`requireTenant` keycloak branch: bearer → `verifyAccessToken` (401 `unauthorized`); `x-alicorn-org` header required (400 `org_header_required`); `organizationsFromClaim` → if the header id is in `resolved` OK; else if `unresolvedAliases.length` and `resolveOrgAliases` given → resolve and retry; else 403 `not_a_member` (or 403 `org_claim_unresolvable` when only aliases exist and no resolver); `userId` = `lookupUserId ? await lookupUserId(claims.sub) : null`; when a resolver is configured and returns null → 401 `unknown_user`; `actor = userId ?? claims.sub`.

- [ ] **Step 1: Failing tests** — claims: object form → `[{ id, alias }]`; array form → `unresolvedAliases`; undefined → empty. Verifier (with `createTestKeycloak`): valid token → claims; wrong `azp` → null; other issuer → null; garbage → null; expired (`expiresIn: '-1s'`) → null. Middleware keycloak mode: token with `organization: { acme: { id: 'org-1' } }`: no header → 400; header `org-2` → 403; header `org-1` + `lookupUserId → 'u1'` → 200 `{ tenantId: 'org-1', actor: 'u1', userId: 'u1' }`; `lookupUserId → null` → 401 `unknown_user`; alias-only token `['acme']` + `resolveOrgAliases → { acme: 'org-1' }` → 200; alias-only without resolver → 403 `org_claim_unresolvable`; local mode still passes its four tests.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement**; wire both apps (`createRemoteJWKSet(new URL(\`${internalIssuer}/protocol/openid-connect/certs\`))`in`index.ts`; `requireTenant`receives the callbacks). Config tests: keycloak mode requires issuer; internal issuer defaults to issuer. **Step 4: Run** — package + both apps' suites green; typecheck. **Step 5: Commit** —`feat(cloud): Keycloak token verification and requireTenant mode keycloak`.

---

### Task 5 (I2b-1): Keycloak token client

**Files:** Create `cloud/apps/control-api/src/keycloak-token-client.ts` + test.

**Interfaces:**

```ts
export type KeycloakTokens = { accessToken: string; refreshToken: string; idToken?: string; expiresIn: number }
export class KeycloakTokenError extends Error { constructor(public status: number, public errorCode: string) }
export function createKeycloakTokenClient(input: { issuer: string; clientId: string; fetch?: typeof fetch }): {
  exchangeCode(args: { code: string; codeVerifier: string; redirectUri: string }): Promise<KeycloakTokens>   // POST ${issuer}/protocol/openid-connect/token, x-www-form-urlencoded: grant_type=authorization_code, client_id, code, redirect_uri, code_verifier
  refresh(args: { refreshToken: string }): Promise<KeycloakTokens>                                            // grant_type=refresh_token, client_id, refresh_token
  logout(args: { refreshToken: string }): Promise<void>                                                       // POST …/logout, client_id, refresh_token; non-2xx ignored
}
```

- [ ] **Step 1: Failing test** with `createTestKeycloak().startServer()` (records the last request body): `exchangeCode` sends the five form params and maps `access_token/refresh_token/id_token/expires_in`; a `400 { error: 'invalid_grant' }` → `KeycloakTokenError { status: 400, errorCode: 'invalid_grant' }`; `redirect: 'error'`, 15 s timeout (`AbortSignal.timeout`).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: PASS + typecheck. Step 5: Commit** — `feat(control-api): Keycloak token client (code exchange, refresh, logout)`.

---

### Task 6 (I2b-2): Desktop auth broker routes

**Files:**

- Create: `cloud/apps/control-api/src/desktop-session-response.ts`, `src/desktop-auth-routes.ts`, `src/desktop-auth-routes-postgres.test.ts`
- Modify: `src/app.ts` (register **before** the `/v1/*` `requireTenant` for `session`/`refresh`; bearer routes verify explicitly via `deps.verifyAccessToken` — they are outside `requireTenant` because they have no `x-alicorn-org`), `src/app-env.ts` (`ControlApiDeps` gains `verifyAccessToken`, `tokenClient`, `now?`)

**Interfaces:**

```ts
export function buildDesktopSessionResponse(input: {
  tokens: KeycloakTokens
  now: number
  user: IdentityUser
  profile: CloudProfileRow
  organizations: Array<{ orgId; name; role }>
  activeOrgName: string | undefined
}): DesktopSessionResponse
// expiresAt = now + tokens.expiresIn * 1000; cloud.linkedAt = now; capabilities = { flags: { alicorn: true, 'relay.use': true }, refreshedAt: now }
export function registerDesktopAuthRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void
```

Routes (`authMode !== 'keycloak'` → every route 404 `{ error: 'not_available_in_local_mode' }`):

- `POST /v1/desktop/auth/session` body `{ code, codeVerifier, nonce, redirectUri, state, localProfileId }` (zod; 400 `invalid_body`) → `tokenClient.exchangeCode` (`KeycloakTokenError` → 401 `{ error: 'exchange_rejected', code }`) → `verifyAccessToken(tokens.accessToken)` (null → 502 `token_unverifiable`) → if `tokens.idToken`: decode (`jose.decodeJwt`) and require `nonce === body.nonce` (400 `nonce_mismatch`) → `upsertUserFromClaims` → `organizationsFromClaim` (+ `resolveOrgAliases` for alias-only) → `syncOrganizations` → `ensureCloudProfile({ userId, localProfileId })` → 200 session response.
- `POST /v1/desktop/auth/refresh` `{ refreshToken }` → `tokenClient.refresh` (error → 401 `refresh_rejected`) → verify → upsert/sync → `getMostRecentCloudProfile` (none → `ensureCloudProfile`) → 200.
- Bearer routes: `readBearer` → `verifyAccessToken` (401) → `lookupUserIdBySubject` (401 `unknown_user`): `capabilities` `{}` → `{ cloud, organizations, capabilities }`; `org` `{ orgId }` → `setActiveTenant` on the most recent profile (`not_a_member` → 403) → `{ cloud, organizations, capabilities }`; `profile` → 501; `logout` `{ refreshToken }` → `tokenClient.logout` → 204.
- [ ] **Step 1: Failing Postgres test** — app built with `config.auth = { authMode: 'keycloak', issuer, internalIssuer: issuer, clientId: 'alicorn-desktop' }` where `issuer` comes from `createTestKeycloak().startServer()` and `verifyAccessToken` uses its `getKey`; the fake token endpoint mints tokens with `organization: { acme: { id: 'org-acme' } }` and an id token with the requested nonce. Assertions: `/session` → 200 and `DesktopSessionResponseSchema`-shaped (write a local zod mirror of the desktop normalizers' requirements in the test: every required field, `expiresAt` > now) with `cloud.activeOrgId === 'org-acme'`, `organizations[0].role === 'owner'`, `capabilities.flags['relay.use'] === true`; wrong nonce → 400; `/refresh` → 200 same profile id; `/capabilities` without bearer → 401; `/org { orgId: 'org-zzz' }` → 403; `/profile` → 501; `/logout` → 204 and the fake server recorded a logout call; in local mode → 404 `not_available_in_local_mode`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: PASS + typecheck. Step 5: Commit** — `feat(control-api): broker the desktop sign-in flow onto Keycloak`.

---

### Task 7 (I5): Relay tokens minted by the Control API

**Files:** Create `cloud/apps/control-api/src/relay-token-signer.ts` + test, `cloud/dev/scripts/generate-relay-signing-key.mjs` (+ `.test.mjs`); modify `config.ts` (`ALICORN_RELAY_SIGNING_JWK?: string` (JSON), `ALICORN_RELAY_TOKEN_ISSUER?: url`), `desktop-auth-routes.ts` (relay-token route), `app.ts` (`GET /.well-known/jwks.json`, unauthenticated), compose (`ALICORN_RELAY_SIGNING_JWK: ${ALICORN_RELAY_SIGNING_JWK:-}` + `ALICORN_RELAY_TOKEN_ISSUER: http://127.0.0.1:8081`), `cloud/package.json` (`alicorn:keygen`), README.

**Interfaces:**

```ts
export type RelayTokenSigner = {
  sign(
    claims: { sub: string; prof: string; org: string; relayHostId: string },
    now: number
  ): Promise<{ relayToken: string; expiresAt: number }>
  jwks(): { keys: JWK[] }
}
export async function createRelayTokenSigner(input: {
  privateJwk: JWK & { kid: string }
  issuer: string
  ttlSeconds?: number /* 900 */
}): Promise<RelayTokenSigner> // ES256, aud 'orca-relay', purpose 'host-control'
```

- `POST /v1/desktop/auth/relay-token` (bearer, keycloak mode) body `{ relayHostId: /^[A-Za-z0-9_-]{16}$/, hostPublicKeyB64: string }` → `{ relayToken, expiresAt }` using `prof` = most recent profile id, `org` = its `active_tenant_id` (400 `no_active_org` if null); 503 `relay_not_configured` when no signing key.
- `generate-relay-signing-key.mjs`: `jose.generateKeyPair('ES256', { extractable: true })` → prints `ALICORN_RELAY_SIGNING_JWK='<private jwk json with kid=<random>>'` for `cloud/dev/compose/.env` (gitignored — add to `.gitignore`).
- [ ] **Step 1: Failing tests** — signer: token verifies with `jwtVerify(token, localJwks, { issuer, audience: 'orca-relay' })` and parses with a copy of the relay's `ClaimsSchema` (`sub, prof, org, relayHostId, purpose: 'host-control', exp`); `expiresAt === now + 900_000`; `jwks()` has one key with `kid`, `alg: 'ES256'`, `use: 'sig'`, no private members (`d` absent). Route test (extend Task 6's file): relay-token → 200 `.strict()` shape; unconfigured key → 503; `GET /.well-known/jwks.json` → 200 without auth.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: PASS + typecheck. Step 5: Commit** — `feat(control-api): mint relay tokens (ES256) and publish JWKS`.

---

### Task 8 (I4): Desktop — `readAlicornBearer` reads the signed-in session

**Files:** Modify `src/main/alicorn/control-plane-session.ts` (+ test) — **Members-module file; touch only this function** (OWNERSHIP.md carve-out). If B1 has not landed when this task starts, stop and coordinate — do not create the file from this plan.

**Interfaces:**

```ts
export type AlicornBearer = { accessToken: string; orgId: string }
export async function readAlicornBearer(
  env: NodeJS.ProcessEnv,
  userDataPath: string
): Promise<AlicornBearer | null>
// 1) env.ALICORN_LOCAL_API_TOKEN (≥16 chars) → { accessToken: token, orgId: env.ALICORN_TENANT_ID ?? 'local' }   (unchanged local behaviour)
// 2) else: const config = getOrcaCloudAuthConfig(); if (!config.configured) return null
//          const active = ensureActiveOrcaProfile(userDataPath); const orgId = active.profile.cloud?.activeOrgId; if (!orgId) return null
//          const fresh = await readFreshOrcaCloudSession(config.config, active, userDataPath); return fresh.status === 'found' ? { accessToken: fresh.session.accessToken, orgId } : null
```

Callers (`getBearer` in B2's client, the drainer's writer) already take a `Promise`; update the one call site that passes `env` only to pass `getProfileUserDataPath()` too (additive).

- [ ] **Step 1: Failing test** — mock `./profile-cloud-session-refresh` and `./profile-index-store` (vi.mock): local token set → local result without touching the session; no token + session found + `activeOrgId 'org-1'` → `{ accessToken, orgId: 'org-1' }`; no cloud profile → null; session `reconnect-required` → null.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4:** `pnpm test src/main/alicorn/control-plane-session.test.ts`, `pnpm tc:node`. **Step 5: Commit** — `feat(alicorn): readAlicornBearer reads the Orca Cloud session in keycloak mode`.

---

### Task 9: Seed, end-to-end proof, docs

**Files:** Modify `cloud/dev/scripts/seed-alicorn-local.mjs` (+ test), `docs/alicorn/ARCHITECTURE.md`, `docs/alicorn/LOCAL-DEV.md` (if present — B1 creates it; else `cloud/README.md`), `docs/alicorn/plans/2026-09-06-tier-1-desktop.md` Task 1 note (`readAlicornBearer` is async since I4).

- [ ] **Step 1: Seed** — when `ALICORN_AUTH_MODE=keycloak`: `adminToken(fetch, kcBase)` (`POST /realms/master/protocol/openid-connect/token`, `grant_type=password&client_id=admin-cli&username=admin&password=…`), `ensureOrganization(fetch, kcBase, token, { name: 'Acme', alias: 'acme', domains: [{ name: 'acme.test' }] })` (GET `/admin/realms/alicorn/organizations?search=acme` → POST if missing, id from `Location`), `ensureMember(fetch, kcBase, token, orgId, 'dev')` (`GET /admin/realms/alicorn/users?username=dev&exact=true` → `POST /admin/realms/alicorn/organizations/{orgId}/members` with the user id as a JSON string; 409 = already a member). Members seed keeps writing the three members into tenant `acme`'s id (the org UUID) when in keycloak mode, `local` otherwise. Unit tests with a stubbed `fetch`.
- [ ] **Step 2: End-to-end proof by hand** — stack up in keycloak mode + seeded; desktop started with the keycloak env block; Settings → Orca Account → Connect → Keycloak login `dev`/`dev` → connected, org **Acme**; Settings → Workflows → Members lists the three members (proves `x-alicorn-org` = the org id flows through `readAlicornBearer` → B2 client → `requireTenant` keycloak mode → RLS); `curl -H "authorization: Bearer <token from the desktop session store is not accessible — use the fake-server test instead>"` is not required. Record in the commit body.
- [ ] **Step 3: ARCHITECTURE.md** — §5 _Status_: built (mode `keycloak`), how the tenant is derived, the `x-alicorn-org` rule, the two claim shapes; §6 identity block: replace with the global tables from Task 3 and the sentence "Identity tables are global — a person belongs to several organisations — so they carry no `tenant_id`; tenancy of a person is `org_roles`."; §8 API surface: add the `/v1/desktop/auth/*` broker and `/.well-known/jwks.json`.
- [ ] **Step 4: Commit** — `feat(cloud): seed Keycloak org and membership; docs for identity`.

---

## Self-review

- **Spec coverage.** I1 (Task 2), I2 (Tasks 1, 4, 5, 6), I3 (Task 3), I4 (Task 8), I5 (Task 7); F1 epic closes with Task 9. ARCHITECTURE §5 (buy identity, `user_id` mapping, IdP swappable — the subject lives in one column) and §9 (least privilege, exceptions) respected. ROADMAP v0.1 _Identity_: "Keycloak 26+ deployed; Control API with org→policy mapping, `user_id` mapping, relay tokens. Desktop repointed." — org→policy mapping = `tenant_id` derivation + `org_roles`; the _policy_ body itself is GP2 (gates plan).
- **Placeholders.** Every task names files, signatures, SQL/JSON, tests and a commit. Task 6/7 assertions reference the test Keycloak defined in Task 4. Task 9 Step 2 is a manual proof by design.
- **Type consistency.** `AuthContext` gains `userId` in Task 1 and is consumed unchanged by tier-1 routes (`actor`). `AuthConfig` union is the single config shape for both services. `OrganizationMembership { id, alias }` is shared by claims parsing (package) and the repository (app). `KeycloakTokens` from Task 5 feeds `buildDesktopSessionResponse` in Task 6 and the relay route in Task 7.
- **Order.** 1 → 2 (independent of 1; can run in parallel with 3) → 3 → 4 → 5 → 6 → 7 → 8 (after B1 exists) → 9.
