# Tier 1 — Control Plane (Postgres · Control API · Ledger API — Keycloak deferred) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the minimum real control plane — a Control API (Members, org policy, project required checks) and a Ledger API (append-only, exactly-once step outcomes, verifications, context captures, provenance and cost reads) — on Postgres, runnable locally with one `docker compose up`. Identity is **deferred**: tier 1 runs auth mode `local` (one constant tenant, one shared bearer); Keycloak arrives in a follow-up plan as a second auth mode without touching routes or schema.

**Architecture:** Two stateless Hono services in the existing `cloud/` pnpm workspace, mirroring `apps/relay` (hono + pg + zod, vitest with a gated real-Postgres project; the Postgres idioms — `pg` Pool, inline `CREATE TABLE IF NOT EXISTS`, `search_path` per connection — are Orca's own). Auth mode `local`: every request carries `authorization: Bearer <ALICORN_LOCAL_API_TOKEN>`; the tenant is the configured constant `ALICORN_TENANT_ID` (default `local`), and an optional `x-alicorn-org` header must equal it. `tenant_id` is still on every product row with row-level security `FORCE`d, so multi-tenant Keycloak organisations slot in later as data, not as a migration (INFRASTRUCTURE §1: "In a self-hosted deployment `tenant_id` is a constant").

**Tech Stack:** Node 24, pnpm 10 (cloud workspace `packageManager`), TypeScript 5.9, hono 4, `@hono/node-server`, `pg` 8, zod 3 (cloud pins `^3.25`; the desktop uses zod 4 — do not share schema files across the boundary), vitest 4, Postgres 16 (`postgres:16-alpine`, the image `cloud-verify.yml` already uses).

**Spec:** `docs/alicorn/PROJECT-BRIEF.md` (§03 base, §08 first slice, §09 gates, §11 decisions), `docs/alicorn/ARCHITECTURE.md` (§5 identity, §6 data model, §9 security), `docs/alicorn/INFRASTRUCTURE.md` (§3 environments), `CLAUDE.md` → *Control plane: Postgres + Keycloak from day one*. Companion plan: `2026-09-06-tier-1-desktop.md` consumes the wire contract defined here.

## Global Constraints

- **Identity is deferred** (user decision 2026-09-06). Auth mode `local` only: shared bearer `ALICORN_LOCAL_API_TOKEN` (≥ 16 chars, required), constant tenant `ALICORN_TENANT_ID` (default `local`). No user accounts, no org roles, no sign-in flow in this plan. Keep `requireTenant` the single place auth happens so Keycloak becomes a second mode later.
- Postgres via `pg`; **one Postgres instance** shared by both services, separate schemas (`control`, `ledger`) — "They share a Postgres instance until measurement says otherwise" (ARCHITECTURE §3).
- **`tenant_id` on every product row, row-level security enabled and forced** (ARCHITECTURE §2.3, §9) — even though tier 1 has exactly one tenant.
- **Ledger is append-only and exactly-once; server time orders everything; `client_ts` is forensics only** (ARCHITECTURE §6).
- **Execution is on the client. No model keys on the server, ever** (ARCHITECTURE §2.1).
- **Wire changes additive only** (ARCHITECTURE §2.4).
- **Keep Control API to three jobs**: org→policy, relay tokens, member and workflow configuration (ROADMAP sequencing rule 5). Relay tokens and the `/v1/desktop/auth/*` broker are **not** in this plan — they arrive with Keycloak.
- New code is Alicorn-branded: packages `@alicorn-cloud/*`, env vars `ALICORN_*`. Do not rename existing `ORCA_*` (CLAUDE.md naming rule).
- No `Co-Authored-By` or AI attribution in commits (user's global git rule).
- Run every command from `cloud/` (independent workspace). Node `>=24 <27`; if `node -v` shows 22, `nvm install 24 && nvm use 24` first; `corepack enable` so `pnpm` resolves to the pinned `10.24.0`.
- Postgres-backed tests read `ALICORN_TEST_POSTGRES_URL` and `describe.skip` without it — same pattern as the relay's `ORCA_RELAY_TEST_POSTGRES_URL`. For local runs: `docker run -d --name alicorn-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test -e POSTGRES_DB=alicorn_test -p 5433:5432 postgres:16-alpine` and `export ALICORN_TEST_POSTGRES_URL=postgres://test:test@127.0.0.1:5433/alicorn_test`.

## Decisions made in this plan (state them, do not relitigate mid-task)

1. **Auth mode `local` is the only mode.** One constant tenant (`ALICORN_TENANT_ID`), one shared bearer. The desktop sends the same two values from its environment. When Keycloak lands: tenant = Keycloak organisation id, bearer = access token — same header names, same middleware seam (`requireTenant`), same schema.
2. **No identity tables in tier 1.** `users`, `tenants`, `org_roles`, `cloud_profiles` (ARCHITECTURE §6) are created by the Keycloak plan. `members.created_by` records the optional `x-alicorn-actor` header, else `'local'`.
3. **Exactly-once key includes `dispatch_id`.** Orca retries a task by creating a *new* `dispatch_contexts` row; a retry's outcome is a distinct step, not a duplicate. Key: `UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id)`. Duplicate deliveries of the same report (retries, reconnects, replay) share the dispatch id and are absorbed.
4. **No table partitioning in tier 1.** A partitioned `step_outcomes` cannot carry the exactly-once unique constraint without the partition key. The constraint is load-bearing; partitions are a capacity optimisation for ~1.2M rows/year (INFRASTRUCTURE §7). Revisit with a side table for the idempotency key when volume demands.
5. **Required checks are authored per project** (`project_required_checks`) until stages exist in v1.5. In local mode the human operator is the admin; the member being judged is an agent and never calls this API.
6. **`member_stage_stats` is written on every outcome insert** (runs, accepted, accept_rate) and is rebuildable. Nothing reads it until gate policy (v1.0); writing it now keeps the v0.1 exit criterion honest.
7. **The auth middleware is duplicated in both apps** (two ~40-line files) rather than a third shared package with an `hono` dependency; consolidate when a third service appears.

## File structure

```
cloud/
  packages/control-plane-contract/           @alicorn-cloud/control-plane-contract — zod wire schemas + types (no pg, no hono)
    src/index.ts                             re-exports
    src/member.ts                            Member, MemberInput, enums
    src/org-policy.ts                        OrgPolicy
    src/required-check.ts                    RequiredCheck (diff_coverage)
    src/ledger.ts                            StepOutcomeInput, StepVerificationInput, ContextCaptureInput, SpendPatch, ProvenanceReport, RunCost
    src/contract.test.ts
  packages/control-plane-postgres/           @alicorn-cloud/control-plane-postgres — pool, schema apply, tenant transactions, test helpers
    src/index.ts
    src/pool.ts                              openControlPlanePool({ databaseUrl, schema, applicationName, poolMax })
    src/apply-schema.ts                      applySchema(pool, statements) — sequential, IF NOT EXISTS + DO-block policies
    src/tenant-transaction.ts                withTenant(pool, tenantId, fn) — BEGIN; set_config('app.tenant_id'); …; COMMIT
    src/rls-policy-sql.ts                    tenantRlsPolicySql(table) — FORCE RLS + policy DO block
    src/postgres-test-schema.ts              createTestSchema/dropTestSchema
    src/*.test.ts
  apps/control-api/                          @alicorn-cloud/control-api
    src/config.ts                            loadControlApiConfig(env)
    src/schema-sql.ts                        CONTROL_SCHEMA_STATEMENTS
    src/app.ts                               createControlApiApp(deps) → Hono
    src/index.ts                             bootstrap
    src/require-tenant.ts                    Hono middleware: local bearer + constant tenant → c.set('auth', { tenantId, actor })
    src/members-repository.ts, members-routes.ts
    src/org-policy-repository.ts, org-policy-routes.ts
    src/required-checks-repository.ts, required-checks-routes.ts
    src/*.test.ts, vitest.config.ts, package.json, tsconfig.json, tsconfig.build.json, Dockerfile
  apps/ledger-api/                           @alicorn-cloud/ledger-api
    src/config.ts, schema-sql.ts, app.ts, index.ts
    src/require-tenant.ts                    same file as control-api's (decision 7)
    src/step-outcomes-repository.ts, step-verifications-repository.ts, context-captures-repository.ts
    src/member-stage-stats.ts                upsert on outcome insert
    src/provenance-repository.ts             provenance by (repo_id, branch); run cost by run_id
    src/ledger-routes.ts
    src/*.test.ts, vitest.config.ts, package.json, tsconfig*.json, Dockerfile
  dev/compose/alicorn-local.yml              postgres · control-api · ledger-api
  dev/compose/desktop.env.example            env the desktop needs to point at the local stack
  dev/scripts/seed-alicorn-local.mjs         creates three members in the local tenant
  dev/scripts/seed-alicorn-local.test.mjs
  README.md                                  + Alicorn section
.github/workflows/cloud-verify.yml           + ALICORN_TEST_POSTGRES_URL
docs/alicorn/ARCHITECTURE.md                 exactly-once key / required-checks anchor / partitions note / identity-deferred note
```

---

### Task 1 (A1): Wire contract package `@alicorn-cloud/control-plane-contract`

**Files:**
- Create: `cloud/packages/control-plane-contract/package.json`, `tsconfig.json`, `tsconfig.build.json`
- Create: `cloud/packages/control-plane-contract/src/{index,member,org-policy,required-check,ledger}.ts`
- Test: `cloud/packages/control-plane-contract/src/contract.test.ts`

**Interfaces:**
- Produces (used by every later task and by the desktop plan): `MemberSchema`, `MemberInputSchema`, `MEMBER_BACKENDS`, `MEMBER_ROLES`, `WORKSPACE_KINDS`, `PERMISSION_MODES`, `OrgPolicySchema`, `RequiredCheckSchema`, `RequiredChecksSchema`, `StepOutcomeInputSchema`, `StepVerificationInputSchema`, `ContextCaptureInputSchema`, `SpendPatchSchema`, `ProvenanceReportSchema`, `RunCostSchema`, and the inferred types (`Member`, `StepOutcomeInput`, …).

- [ ] **Step 1: Scaffold the package** (copy the relay-contract shape)

`cloud/packages/control-plane-contract/package.json`:
```json
{
  "name": "@alicorn-cloud/control-plane-contract",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "pnpm clean && tsc -p tsconfig.build.json",
    "clean": "node -e \"require('fs').rmSync('dist', { recursive: true, force: true })\"",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "zod": "^3.25.76" },
  "devDependencies": { "@types/node": "^24.10.0", "typescript": "^5.9.3", "vitest": "^4.0.8" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts"] }`
`tsconfig.build.json`: `{ "extends": "./tsconfig.json", "compilerOptions": { "declaration": true, "emitDeclarationOnly": false, "noEmit": false, "outDir": "dist", "rootDir": "src" }, "exclude": ["src/**/*.test.ts"] }`

- [ ] **Step 2: Write the failing contract test**

`src/contract.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemberInputSchema, StepOutcomeInputSchema } from './index.js'

describe('control-plane contract', () => {
  it('accepts a minimal member input and applies defaults', () => {
    const parsed = MemberInputSchema.parse({
      name: 'Reviewer',
      role: 'reviewer',
      backend: 'codex',
      workspaceKind: 'worktree',
      permissionMode: 'accept_edits'
    })
    expect(parsed.systemRules).toBe('')
    expect(parsed.skills).toEqual([])
  })

  it('rejects an unknown backend', () => {
    expect(() =>
      MemberInputSchema.parse({ name: 'x', role: 'developer', backend: 'gemini', workspaceKind: 'worktree', permissionMode: 'ask' })
    ).toThrow()
  })

  it('defaults execution strategy to single and stage key to build', () => {
    const parsed = StepOutcomeInputSchema.parse({
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'succeeded'
    })
    expect(parsed.executionStrategy).toBe('single')
    expect(parsed.stageKey).toBe('build')
    expect(parsed.filesModified).toEqual([])
  })

})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd cloud && pnpm install && pnpm --filter @alicorn-cloud/control-plane-contract test`
Expected: FAIL — `Cannot find module './index.js'`. (3 tests.)

- [ ] **Step 4: Implement the schemas**

`src/member.ts`:
```ts
import { z } from 'zod'

export const MEMBER_BACKENDS = ['claude', 'codex', 'grok', 'openclaude'] as const
export const MEMBER_ROLES = ['developer', 'reviewer', 'qa', 'analyst', 'other'] as const
export const WORKSPACE_KINDS = ['worktree', 'folder'] as const
export const PERMISSION_MODES = ['ask', 'accept_edits', 'yolo'] as const

export const MemberBackendSchema = z.enum(MEMBER_BACKENDS)
export const MemberRoleSchema = z.enum(MEMBER_ROLES)

export const MemberInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: MemberRoleSchema,
  backend: MemberBackendSchema,
  workspaceKind: z.enum(WORKSPACE_KINDS),
  permissionMode: z.enum(PERMISSION_MODES),
  systemRules: z.string().max(20_000).default(''),
  skills: z.array(z.string().trim().min(1).max(200)).max(50).default([])
})

export const MemberSchema = MemberInputSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export type MemberBackend = z.infer<typeof MemberBackendSchema>
export type MemberRole = z.infer<typeof MemberRoleSchema>
export type MemberInput = z.infer<typeof MemberInputSchema>
export type Member = z.infer<typeof MemberSchema>
```

`src/org-policy.ts`:
```ts
import { z } from 'zod'
// Why: decision §11.4 — enforced by default, explicit opt-out, bypass recorded on the run.
export const OrgPolicySchema = z.object({
  enforceDistinctReviewerBackend: z.boolean().default(true)
})
export type OrgPolicy = z.infer<typeof OrgPolicySchema>
```

`src/required-check.ts`:
```ts
import { z } from 'zod'
export const DiffCoverageCheckSchema = z.object({
  kind: z.literal('diff_coverage'),
  threshold: z.number().min(0).max(1),
  lcovPath: z.string().min(1).default('coverage/lcov.info'),
  // Why: optional — a project whose test run already writes lcov needs no extra command.
  command: z.string().min(1).max(1000).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000)
})
export const RequiredCheckSchema = z.discriminatedUnion('kind', [DiffCoverageCheckSchema])
export const RequiredChecksSchema = z.array(RequiredCheckSchema).max(20)
export type RequiredCheck = z.infer<typeof RequiredCheckSchema>
```

`src/ledger.ts`:
```ts
import { z } from 'zod'
import { MemberBackendSchema } from './member.js'

export const EXECUTION_STRATEGIES = ['single', 'orchestrated'] as const
export const ExecutionStrategySchema = z.enum(EXECUTION_STRATEGIES)

export const StepOutcomeInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  worktreeId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  memberId: z.string().min(1).optional(),
  // Why: `other` covers agents Orca launches but Alicorn does not price or police.
  backend: z.union([MemberBackendSchema, z.literal('other')]).default('other'),
  stageKey: z.string().min(1).max(64).default('build'),
  executionStrategy: ExecutionStrategySchema.default('single'),
  outcome: z.enum(['succeeded', 'failed']),
  filesModified: z.array(z.string()).max(5000).default([]),
  reportSummary: z.string().max(4000).optional(),
  reviewBackendBypass: z.boolean().default(false),
  escalationOffered: z.boolean().default(false),
  escalationAccepted: z.boolean().nullable().default(null),
  clientTs: z.string().datetime().optional()
})

export const SpendPatchSchema = z.object({
  spendCents: z.number().int().nonnegative().nullable(),
  usage: z.record(z.unknown()).nullable()
})

export const StepVerificationInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  kind: z.enum(['diff_coverage']),
  name: z.string().min(1).max(200),
  required: z.boolean(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  detail: z.record(z.unknown()).default({})
})

export const CONTEXT_CAPTURE_MAX_PROMPT_BYTES = 64 * 1024
export const ContextCaptureInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  // Why: exactly one of prompt / promptPath — overflow is written to a file and the path is recorded.
  prompt: z.string().max(CONTEXT_CAPTURE_MAX_PROMPT_BYTES).optional(),
  promptPath: z.string().min(1).optional(),
  contextSlice: z.record(z.unknown()).default({})
}).refine((v) => (v.prompt === undefined) !== (v.promptPath === undefined), 'exactly one of prompt or promptPath')

export const StepOutcomeRecordSchema = StepOutcomeInputSchema.extend({
  id: z.string(),
  tenantId: z.string(),
  spendCents: z.number().int().nullable(),
  usage: z.record(z.unknown()).nullable(),
  gateDecision: z.string(),
  gateReason: z.string(),
  createdAt: z.string().datetime()
})
export const StepVerificationRecordSchema = StepVerificationInputSchema.extend({ id: z.string(), createdAt: z.string().datetime() })

export const ProvenanceReportSchema = z.object({
  repoId: z.string(),
  branch: z.string(),
  outcomes: z.array(StepOutcomeRecordSchema),
  verifications: z.array(StepVerificationRecordSchema),
  contextCaptures: z.array(z.object({ dispatchId: z.string(), promptBytes: z.number().int(), createdAt: z.string() })),
  totals: z.object({ spendCents: z.number().int(), tasks: z.number().int(), dispatches: z.number().int() }),
  reviewBackend: z.object({ enforced: z.boolean(), bypassed: z.boolean() })
})

export const RunCostSchema = z.object({
  runId: z.string(),
  totalSpendCents: z.number().int(),
  byDispatch: z.array(z.object({ dispatchId: z.string(), taskId: z.string(), backend: z.string(), spendCents: z.number().int().nullable() }))
})

export type ExecutionStrategy = z.infer<typeof ExecutionStrategySchema>
export type StepOutcomeInput = z.infer<typeof StepOutcomeInputSchema>
export type StepOutcomeRecord = z.infer<typeof StepOutcomeRecordSchema>
export type SpendPatch = z.infer<typeof SpendPatchSchema>
export type StepVerificationInput = z.infer<typeof StepVerificationInputSchema>
export type ContextCaptureInput = z.infer<typeof ContextCaptureInputSchema>
export type ProvenanceReport = z.infer<typeof ProvenanceReportSchema>
export type RunCost = z.infer<typeof RunCostSchema>
```

`src/index.ts`: `export * from './member.js'` … one line per module (`org-policy`, `required-check`, `ledger`).

- [ ] **Step 5: Run tests, typecheck, build**

Run: `pnpm --filter @alicorn-cloud/control-plane-contract test && pnpm --filter @alicorn-cloud/control-plane-contract typecheck && pnpm --filter @alicorn-cloud/control-plane-contract build`
Expected: 3 tests PASS; `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add cloud/packages/control-plane-contract cloud/pnpm-lock.yaml
git commit -m "feat(cloud): add control-plane wire contract package"
```

---

### Task 2 (A2): Postgres helpers package `@alicorn-cloud/control-plane-postgres`

**Files:**
- Create: `cloud/packages/control-plane-postgres/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `src/{index,pool,apply-schema,tenant-transaction,rls-policy-sql,postgres-test-schema}.ts`
- Test: `src/tenant-transaction-postgres.test.ts`, `src/rls-policy-sql.test.ts`

**Interfaces:**
- Produces: `openControlPlanePool(input: { databaseUrl: string; schema: string; applicationName: string; poolMax?: number }): Promise<pg.Pool>` (creates the schema, sets `search_path` per connection); `applySchema(pool, statements: readonly string[]): Promise<void>`; `withTenant<T>(pool, tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>`; `withoutTenant<T>(pool, fn)` (plain transaction, identity tables only); `tenantRlsPolicySql(table: string): string`; `scopedTestDatabaseUrl(baseUrl, schema)`, `createTestSchema(baseUrl, schema)`, `dropTestSchema(baseUrl, schema)`; `describePostgres` helper: `export const describePostgres = process.env.ALICORN_TEST_POSTGRES_URL ? describe : describe.skip` lives in each test file (vitest import), not in the package.

- [ ] **Step 1: Scaffold** — package.json like A1 but name `@alicorn-cloud/control-plane-postgres`, dependencies `{ "pg": "^8.22.0" }`, devDependencies add `"@types/pg": "^8.20.0"`. `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
// Why: Postgres tests share one database; keep them serial like the relay's `relay-postgres` project.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], fileParallelism: false, testTimeout: 15_000, hookTimeout: 15_000 } })
```

- [ ] **Step 2: Failing unit test for the policy SQL**

`src/rls-policy-sql.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { tenantRlsPolicySql } from './rls-policy-sql.js'

describe('tenantRlsPolicySql', () => {
  it('forces RLS and creates an idempotent tenant policy', () => {
    const sql = tenantRlsPolicySql('members')
    expect(sql).toContain('ALTER TABLE members ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE members FORCE ROW LEVEL SECURITY')
    expect(sql).toContain("policyname = 'members_tenant_isolation'")
    expect(sql).toContain("current_setting('app.tenant_id', true)")
  })
  it('rejects identifiers that are not plain snake_case', () => {
    expect(() => tenantRlsPolicySql('members; DROP TABLE users')).toThrow()
  })
})
```

- [ ] **Step 3: Failing Postgres test for tenant isolation**

`src/tenant-transaction-postgres.test.ts`:
```ts
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySchema } from './apply-schema.js'
import { openControlPlanePool } from './pool.js'
import { createTestSchema, dropTestSchema } from './postgres-test-schema.js'
import { tenantRlsPolicySql } from './rls-policy-sql.js'
import { withTenant } from './tenant-transaction.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'cp_tenant_tx_test'

describePostgres('withTenant', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: databaseUrl!, schema, applicationName: 'cp-test' })
    await applySchema(pool, [
      `CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`,
      tenantRlsPolicySql('widgets')
    ])
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('isolates rows by tenant even for the owning role', async () => {
    await withTenant(pool, 'tenant-a', (c) => c.query(`INSERT INTO widgets VALUES ('w1', 'tenant-a', 'A')`))
    await withTenant(pool, 'tenant-b', (c) => c.query(`INSERT INTO widgets VALUES ('w2', 'tenant-b', 'B')`))
    const a = await withTenant(pool, 'tenant-a', (c) => c.query(`SELECT id FROM widgets ORDER BY id`))
    expect(a.rows.map((r) => r.id)).toEqual(['w1'])
    const none = await pool.query(`SELECT id FROM widgets`)
    expect(none.rows).toEqual([]) // no tenant set → policy false → nothing visible
  })

  it('refuses to insert a row for another tenant', async () => {
    await expect(
      withTenant(pool, 'tenant-a', (c) => c.query(`INSERT INTO widgets VALUES ('w3', 'tenant-b', 'X')`))
    ).rejects.toMatchObject({ code: '42501' })
  })
})
```

- [ ] **Step 4: Run both to verify they fail**

Run: `pnpm --filter @alicorn-cloud/control-plane-postgres test`
Expected: FAIL — modules not found (the Postgres suite skips if the env var is unset; export it for a real run).

- [ ] **Step 5: Implement**

`src/rls-policy-sql.ts`:
```ts
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`invalid_identifier:${name}`)
  return name
}
// Why: CREATE POLICY has no IF NOT EXISTS; the DO block makes schema apply idempotent.
export function tenantRlsPolicySql(table: string): string {
  const t = assertIdentifier(table)
  const policy = `${t}_tenant_isolation`
  return `
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = '${t}' AND policyname = '${policy}') THEN
    EXECUTE 'CREATE POLICY ${policy} ON ${t} USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;`
}
```

`src/pool.ts`:
```ts
import pg from 'pg'
import { assertIdentifier } from './rls-policy-sql.js'

export async function openControlPlanePool(input: {
  databaseUrl: string
  schema: string
  applicationName: string
  poolMax?: number
}): Promise<pg.Pool> {
  const schema = assertIdentifier(input.schema)
  const admin = new pg.Client({ connectionString: input.databaseUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
  } finally {
    await admin.end()
  }
  const url = new URL(input.databaseUrl)
  // Why: search_path per connection keeps both services' tables in one database without name clashes.
  url.searchParams.set('options', `-c search_path=${schema}`)
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: input.poolMax ?? 10,
    application_name: input.applicationName,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 10_000
  })
  pool.on('error', () => {}) // idle-client errors surface on the next checkout
  return pool
}
```

`src/apply-schema.ts`:
```ts
import type pg from 'pg'
export async function applySchema(pool: pg.Pool, statements: readonly string[]): Promise<void> {
  const client = await pool.connect()
  try {
    for (const statement of statements) {
      await client.query(statement)
    }
  } finally {
    client.release()
  }
}
```

`src/tenant-transaction.ts`:
```ts
import type pg from 'pg'
async function transaction<T>(pool: pg.Pool, prepare: (c: pg.PoolClient) => Promise<void>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await prepare(client)
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
// Why: set_config(..., true) is transaction-local, so a pooled connection never leaks a tenant.
export function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error('tenant_required')
  return transaction(pool, async (c) => { await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]) }, fn)
}
export function withoutTenant<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(pool, async () => {}, fn)
}
```

`src/postgres-test-schema.ts`:
```ts
import pg from 'pg'
import { assertIdentifier } from './rls-policy-sql.js'
async function run(baseUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl })
  await client.connect()
  try { await client.query(sql) } finally { await client.end() }
}
export function createTestSchema(baseUrl: string, schema: string): Promise<void> {
  const s = assertIdentifier(schema)
  return run(baseUrl, `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s}`)
}
export function dropTestSchema(baseUrl: string, schema: string): Promise<void> {
  return run(baseUrl, `DROP SCHEMA IF EXISTS ${assertIdentifier(schema)} CASCADE`)
}
```

`src/index.ts` re-exports all five modules.

- [ ] **Step 6: Run tests with a real Postgres**

Run: `export ALICORN_TEST_POSTGRES_URL=postgres://test:test@127.0.0.1:5433/alicorn_test && pnpm --filter @alicorn-cloud/control-plane-postgres test && pnpm --filter @alicorn-cloud/control-plane-postgres typecheck`
Expected: 4 tests PASS (2 unit, 2 Postgres).

- [ ] **Step 7: Commit**

```bash
git add cloud/packages/control-plane-postgres cloud/pnpm-lock.yaml
git commit -m "feat(cloud): add Postgres pool, schema apply and forced-RLS tenant transactions"
```

---

### Task 3 (A3): Control API skeleton — config, schema, `/healthz`, bootstrap

**Files:**
- Create: `cloud/apps/control-api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `Dockerfile`
- Create: `cloud/apps/control-api/src/{config,schema-sql,app,index}.ts`
- Test: `src/config.test.ts`, `src/app.test.ts`, `src/schema-postgres.test.ts`

**Interfaces:**
- Produces: `loadControlApiConfig(env): ControlApiConfig` with fields `port`, `databaseUrl`, `databaseSchema`, `poolMax`, `authMode: 'local'`, `tenantId`, `localApiToken`; `CONTROL_SCHEMA_STATEMENTS: readonly string[]`; `createControlApiApp(deps: ControlApiDeps): Hono` where `ControlApiDeps = { config: ControlApiConfig; pool: pg.Pool; now?: () => number }`.

- [ ] **Step 1: Scaffold** — `package.json` copied from `apps/relay/package.json` with name `@alicorn-cloud/control-api`, `dev: tsx watch src/index.ts`, dependencies `@hono/node-server ^1.19.14`, `hono ^4.12.27`, `pg ^8.22.0`, `zod ^3.25.76`, `@alicorn-cloud/control-plane-contract: workspace:*`, `@alicorn-cloud/control-plane-postgres: workspace:*`; `pretest: pnpm --filter @alicorn-cloud/control-plane-contract build && pnpm --filter @alicorn-cloud/control-plane-postgres build`. `vitest.config.ts` = copy of `apps/relay/vitest.config.ts` with the env var name replaced by `ALICORN_TEST_POSTGRES_URL` and project names `control-api` / `control-api-postgres`. `Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @alicorn-cloud/control-api... build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
CMD ["node", "apps/control-api/dist/index.js"]
```
(build context is `cloud/`; the `...` filter builds dependencies too.)

- [ ] **Step 2: Failing tests**

`src/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadControlApiConfig } from './config.js'
const base = {
  ALICORN_DATABASE_URL: 'postgres://u:p@db:5432/alicorn',
  ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789'
}
describe('loadControlApiConfig', () => {
  it('applies defaults', () => {
    const c = loadControlApiConfig(base)
    expect(c.port).toBe(8081)
    expect(c.databaseSchema).toBe('control')
    expect(c.authMode).toBe('local')
    expect(c.tenantId).toBe('local')
  })
  it('fails without a database url', () => {
    expect(() => loadControlApiConfig({ ALICORN_LOCAL_API_TOKEN: base.ALICORN_LOCAL_API_TOKEN })).toThrow()
  })
  it('refuses a short shared token', () => {
    expect(() => loadControlApiConfig({ ...base, ALICORN_LOCAL_API_TOKEN: 'short' })).toThrow()
  })
})
```

`src/app.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
export function testDeps(overrides: Partial<Parameters<typeof createControlApiApp>[0]> = {}) {
  return {
    config: loadControlApiConfig({ ALICORN_DATABASE_URL: 'postgres://x', ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789' }),
    pool: {} as never,
    ...overrides
  }
}
describe('control-api app', () => {
  it('answers healthz', async () => {
    const res = await createControlApiApp(testDeps()).request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, service: 'control-api' })
  })
})
```

`src/schema-postgres.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySchema, createTestSchema, dropTestSchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'
const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_schema_test'
describePostgres('control schema', () => {
  beforeAll(() => createTestSchema(databaseUrl!, schema))
  afterAll(() => dropTestSchema(databaseUrl!, schema))
  it('applies twice without error and forces RLS on tenant tables', async () => {
    const pool = await openControlPlanePool({ databaseUrl: databaseUrl!, schema, applicationName: 't' })
    try {
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
      const { rows } = await pool.query(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relforcerowsecurity ORDER BY relname`, [schema])
      expect(rows.map((r) => r.relname)).toEqual(['member_skills', 'members', 'org_policies', 'project_required_checks'])
    } finally {
      await pool.end()
    }
  })
})
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @alicorn-cloud/control-api test` → FAIL, modules missing.

- [ ] **Step 4: Implement**

`src/config.ts`:
```ts
import { z } from 'zod'
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8081),
  ALICORN_DATABASE_URL: z.string().min(1),
  ALICORN_DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]*$/).default('control'),
  ALICORN_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  // Why: identity is deferred; `local` is the only mode until the Keycloak plan adds `keycloak`.
  ALICORN_AUTH_MODE: z.enum(['local']).default('local'),
  ALICORN_TENANT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('local'),
  ALICORN_LOCAL_API_TOKEN: z.string().min(16)
})
export type ControlApiConfig = {
  port: number
  databaseUrl: string
  databaseSchema: string
  poolMax: number
  authMode: 'local'
  tenantId: string
  localApiToken: string
}
export function loadControlApiConfig(env: NodeJS.ProcessEnv = process.env): ControlApiConfig {
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
```

`src/schema-sql.ts` (ARCHITECTURE §6 product tables; *Decisions* 2 and 5):
```ts
import { tenantRlsPolicySql } from '@alicorn-cloud/control-plane-postgres'
export const CONTROL_SCHEMA_STATEMENTS: readonly string[] = [
  // Identity tables (users, tenants, org_roles, cloud_profiles) arrive with the Keycloak plan.
  // Product configuration — tenant-scoped, RLS forced.
  `CREATE TABLE IF NOT EXISTS members (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('developer', 'reviewer', 'qa', 'analyst', 'other')),
     backend TEXT NOT NULL CHECK (backend IN ('claude', 'codex', 'grok', 'openclaude')),
     workspace_kind TEXT NOT NULL CHECK (workspace_kind IN ('worktree', 'folder')),
     permission_mode TEXT NOT NULL CHECK (permission_mode IN ('ask', 'accept_edits', 'yolo')),
     system_rules TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS members_tenant ON members(tenant_id, name)`,
  tenantRlsPolicySql('members'),
  `CREATE TABLE IF NOT EXISTS member_skills (
     tenant_id TEXT NOT NULL,
     member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     skill_id TEXT NOT NULL,
     PRIMARY KEY (member_id, skill_id))`,
  tenantRlsPolicySql('member_skills'),
  `CREATE TABLE IF NOT EXISTS org_policies (
     tenant_id TEXT PRIMARY KEY,
     enforce_distinct_reviewer_backend BOOLEAN NOT NULL DEFAULT true,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  tenantRlsPolicySql('org_policies'),
  `CREATE TABLE IF NOT EXISTS project_required_checks (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     checks JSONB NOT NULL DEFAULT '[]'::jsonb,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id))`,
  tenantRlsPolicySql('project_required_checks')
]
```

`src/app.ts`:
```ts
import { Hono } from 'hono'
import type pg from 'pg'
import type { ControlApiConfig } from './config.js'

export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
}

export function createControlApiApp(deps: ControlApiDeps): Hono {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'control-api' }))
  // Routes are registered by later tasks: registerMembersRoutes(app, deps) (A5),
  // registerOrgPolicyRoutes / registerRequiredChecksRoutes (A6).
  return app
}
```

`src/index.ts`:
```ts
import { serve } from '@hono/node-server'
import { applySchema, openControlPlanePool } from '@alicorn-cloud/control-plane-postgres'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const config = loadControlApiConfig()
const pool = await openControlPlanePool({
  databaseUrl: config.databaseUrl, schema: config.databaseSchema,
  applicationName: 'alicorn-control-api', poolMax: config.poolMax
})
await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
const app = createControlApiApp({ config, pool })
serve({ fetch: app.fetch, port: config.port }, () => console.log(`[alicorn-control-api] listening on :${config.port}`))
```

- [ ] **Step 5: Run** — `pnpm --filter @alicorn-cloud/control-api test && pnpm --filter @alicorn-cloud/control-api typecheck` → 5 tests PASS (schema test needs `ALICORN_TEST_POSTGRES_URL`).

- [ ] **Step 6: Commit**
```bash
git add cloud/apps/control-api cloud/pnpm-lock.yaml
git commit -m "feat(control-api): scaffold service with config, schema and healthz"
```

---

### Task 4 (A4): Local auth middleware `requireTenant`

**Files:**
- Create: `cloud/apps/control-api/src/require-tenant.ts`
- Test: `cloud/apps/control-api/src/require-tenant.test.ts`

**Interfaces:**
- Produces: `requireTenant(deps: { config: { tenantId: string; localApiToken: string } })` — a Hono middleware. `authorization` must be exactly `Bearer <localApiToken>` (constant-time compare via `timingSafeEqual` on equal-length buffers) → else 401 `{ error: 'unauthorized' }`. `x-alicorn-org`, when present, must equal `config.tenantId` → else 403 `{ error: 'not_a_member' }`. Sets `c.set('auth', { tenantId: config.tenantId, actor: c.req.header('x-alicorn-actor')?.slice(0, 120) ?? 'local' })`. Type `AuthContext = { tenantId: string; actor: string }`; declare Hono `Variables: { auth: AuthContext }` so `c.get('auth')` is typed.
- Also `readBearer(header: string | undefined): string | null` (same regex as the relay's).
- This is the **only** seam auth passes through; the Keycloak plan adds `authMode === 'keycloak'` here without touching routes.

- [ ] **Step 1: Failing test**
```ts
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireTenant, type AuthContext } from './require-tenant.js'

const config = { tenantId: 'local', localApiToken: 'local-dev-token-0123456789' }
function app() {
  const a = new Hono<{ Variables: { auth: AuthContext } }>()
  a.use('/v1/*', requireTenant({ config }))
  a.get('/v1/whoami', (c) => c.json(c.get('auth')))
  return a
}
describe('requireTenant (local mode)', () => {
  it('rejects a missing or wrong bearer', async () => {
    expect((await app().request('/v1/whoami')).status).toBe(401)
    expect((await app().request('/v1/whoami', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })
  it('rejects another tenant', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}`, 'x-alicorn-org': 'acme' } })
    expect(res.status).toBe(403)
  })
  it('accepts the shared token and stamps tenant + actor', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}`, 'x-alicorn-org': 'local', 'x-alicorn-actor': 'huy' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'huy' })
  })
  it('defaults the actor', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}` } })
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'local' })
  })
})
```
- [ ] **Step 2: Run** `pnpm --filter @alicorn-cloud/control-api test` → FAIL (module missing).
- [ ] **Step 3: Implement**
```ts
import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

export type AuthContext = { tenantId: string; actor: string }

export function readBearer(value: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(value ?? '')
  return match?.[1] ?? null
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function requireTenant(deps: {
  config: { tenantId: string; localApiToken: string }
}): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const bearer = readBearer(c.req.header('authorization'))
    if (!bearer || !tokenMatches(bearer, deps.config.localApiToken)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const org = c.req.header('x-alicorn-org')
    if (org !== undefined && org !== deps.config.tenantId) {
      return c.json({ error: 'not_a_member' }, 403)
    }
    c.set('auth', { tenantId: deps.config.tenantId, actor: c.req.header('x-alicorn-actor')?.slice(0, 120) ?? 'local' })
    await next()
  }
}
```
- [ ] **Step 4: Run** → 4 PASS; `pnpm --filter @alicorn-cloud/control-api typecheck` clean.
- [ ] **Step 5: Commit** `feat(control-api): local-mode tenant middleware (shared bearer, constant tenant)`.

---

### Task 5 (A5): Members CRUD

**Files:**
- Create: `cloud/apps/control-api/src/members-repository.ts`, `src/members-routes.ts`
- Modify: `src/app.ts` — `app.use('/v1/*', requireTenant(deps))` then `registerMembersRoutes(app, deps)`
- Test: `src/members-routes-postgres.test.ts`

**Interfaces:**
- Consumes: A4 `requireTenant` (`c.get('auth')` → `{ tenantId, actor }`).
- Produces repository (all via `withTenant(pool, tenantId, …)`): `listMembers(pool, tenantId): Promise<Member[]>`, `getMember(pool, tenantId, id)`, `createMember(pool, tenantId, createdBy, input: MemberInput): Promise<Member>`, `updateMember(pool, tenantId, id, input: MemberInput): Promise<Member | null>`, `deleteMember(pool, tenantId, id): Promise<boolean>`. Skills are stored in `member_skills` and returned as `skills: string[]` sorted.
- Routes: `GET /v1/members` → `{ members }`; `POST /v1/members` (body `MemberInputSchema`, 400 on zod error `{ error: 'invalid_body', issues }`) → 201 `{ member }`; `GET /v1/members/:id` → 200/404; `PUT /v1/members/:id` → 200/404; `DELETE /v1/members/:id` → 204/404.

- [ ] **Step 1: Failing Postgres route test** — app with `config.tenantId = 'local'`; headers `authorization: Bearer <token>`, `x-alicorn-actor: huy`; `POST /v1/members` → 201 with `createdBy: 'huy'`; `GET /v1/members` → 1 member with `skills: ['code-review']`; RLS is real, not a WHERE clause: `SELECT count(*) FROM members` under `withTenant(pool, 'other-tenant')` = 0 while under `withTenant(pool, 'local')` = 1; `PUT` changes backend to `codex`; `DELETE` → 204 then 404; a request with `x-alicorn-org: acme` → 403.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`INSERT INTO members (tenant_id, name, role, backend, workspace_kind, permission_mode, system_rules, created_by) VALUES ($1..$8) RETURNING *` with `created_by = auth.actor`; skills replaced with `DELETE FROM member_skills WHERE member_id = $1` + multi-row insert inside the same `withTenant` transaction). **Step 4: Run** → PASS. **Step 5: Commit** `feat(control-api): Members CRUD behind forced RLS`.

---

### Task 6 (A6): Org policy and project required checks

**Files:**
- Create: `src/org-policy-repository.ts`, `src/org-policy-routes.ts`, `src/required-checks-repository.ts`, `src/required-checks-routes.ts`
- Modify: `src/app.ts`
- Test: `src/policy-routes-postgres.test.ts`

**Interfaces:**
- `getOrgPolicy(pool, tenantId): Promise<OrgPolicy>` — returns `{ enforceDistinctReviewerBackend: true }` when no row (the default is the safe one). `putOrgPolicy(pool, tenantId, updatedBy, policy)` upserts.
- `getRequiredChecks(pool, tenantId, projectId): Promise<RequiredCheck[]>` (empty when no row), `putRequiredChecks(pool, tenantId, projectId, updatedBy, checks)`.
- Routes: `GET /v1/policy/review-backend` → `OrgPolicy`; `PUT /v1/policy/review-backend` (body `OrgPolicySchema`) → 200; `GET /v1/projects/:projectId/required-checks` → `{ checks }`; `PUT /v1/projects/:projectId/required-checks` (body `{ checks: RequiredChecksSchema }`) → 200. `projectId` is Orca's project/repo id string (opaque here). `updated_by = auth.actor`.
- Authoring rule: "A member cannot loosen its own criteria. Required checks are authored on the stage, not by the member being judged" (ARCHITECTURE §9). In local mode the human operator holding the shared token is the admin; agents never receive the token (the desktop main process holds it, not the worker terminals). Role-based admin checks arrive with Keycloak.

- [ ] **Step 1: Failing Postgres test** — default policy is enforce=true with no row; `PUT { enforceDistinctReviewerBackend: false }` → 200 then `GET` → false and `updated_by = 'huy'`; `PUT /v1/projects/repo-1/required-checks { checks: [{ kind: 'diff_coverage', threshold: 0.8 }] }` → 200, `GET` returns the check with defaults `lcovPath: 'coverage/lcov.info'`, `timeoutMs: 600000`; invalid kind → 400.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`INSERT … ON CONFLICT (tenant_id) DO UPDATE`, `checks` stored as `JSONB` via `JSON.stringify`). **Step 4: Run** → PASS. **Step 5: Commit** `feat(control-api): org review-backend policy and per-project required checks`.

---

### Task 7 (A7): Ledger API skeleton and schema

**Files:**
- Create: `cloud/apps/ledger-api/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,Dockerfile}` (as A3, name `@alicorn-cloud/ledger-api`, default `PORT` 8082, default schema `ledger`)
- Create: `src/{config,schema-sql,app,index,require-tenant}.ts` — `config.ts` mirrors control-api's (`PORT` default 8082, schema default `ledger`, same `ALICORN_AUTH_MODE`/`ALICORN_TENANT_ID`/`ALICORN_LOCAL_API_TOKEN`); `require-tenant.ts` is a copy of control-api's A4 file with its test (decision 7).
- Test: `src/config.test.ts`, `src/schema-postgres.test.ts` (forced-RLS tables = `context_captures, member_stage_stats, step_outcomes, step_verifications`)

**Schema** (`LEDGER_SCHEMA_STATEMENTS`, ARCHITECTURE §6 + *Decisions* 3, 4, 6):
```sql
CREATE TABLE IF NOT EXISTS step_outcomes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
  project_id TEXT, repo_id TEXT, worktree_id TEXT, branch TEXT,
  member_id TEXT, backend TEXT NOT NULL DEFAULT 'other',
  stage_key TEXT NOT NULL DEFAULT 'build',
  execution_strategy TEXT NOT NULL DEFAULT 'single' CHECK (execution_strategy IN ('single','orchestrated')),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded','failed')),
  files_modified JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_summary TEXT,
  spend_cents INTEGER, usage JSONB,
  gate_decision TEXT NOT NULL DEFAULT 'human',   -- level 0: every gate still fires
  gate_reason TEXT NOT NULL DEFAULT 'level0', gate_id TEXT,
  human_verdict TEXT CHECK (human_verdict IN ('accepted','rejected','amended')),
  amended_after_ms INTEGER,
  review_backend_bypass BOOLEAN NOT NULL DEFAULT false,
  escalation_offered BOOLEAN NOT NULL DEFAULT false,
  escalation_accepted BOOLEAN,
  client_ts TIMESTAMPTZ,                         -- forensics only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- server time orders everything
  UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id)
);
CREATE INDEX IF NOT EXISTS step_outcomes_track_record ON step_outcomes (tenant_id, member_id, stage_key, created_at DESC);
CREATE INDEX IF NOT EXISTS step_outcomes_branch ON step_outcomes (tenant_id, repo_id, branch, created_at DESC);
CREATE INDEX IF NOT EXISTS step_outcomes_run ON step_outcomes (tenant_id, run_id);
-- + tenantRlsPolicySql('step_outcomes')
CREATE TABLE IF NOT EXISTS step_verifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
  kind TEXT NOT NULL, name TEXT NOT NULL, required BOOLEAN NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','error')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dispatch_id, kind, name)
);
CREATE TABLE IF NOT EXISTS context_captures (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
  prompt TEXT, prompt_path TEXT, prompt_bytes INTEGER NOT NULL,
  context_slice JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dispatch_id)
);
CREATE TABLE IF NOT EXISTS member_stage_stats (   -- derived; rebuildable from step_outcomes
  tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, stage_key TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
  runs INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
  accept_rate NUMERIC(5,4) NOT NULL DEFAULT 0, last_amended_at TIMESTAMPTZ,
  level INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, member_id, stage_key, project_id)
);
```
plus `tenantRlsPolicySql(...)` after each table.

- [ ] Steps: failing config + schema tests (as A3) → implement → `pnpm --filter @alicorn-cloud/ledger-api test && … typecheck` PASS → commit `feat(ledger-api): scaffold service with append-only ledger schema`.

---

### Task 8 (A8): Ledger routes — exactly-once writes, provenance and cost reads

**Files:**
- Create: `src/step-outcomes-repository.ts`, `src/step-verifications-repository.ts`, `src/context-captures-repository.ts`, `src/member-stage-stats.ts`, `src/provenance-repository.ts`, `src/ledger-routes.ts`
- Modify: `src/app.ts`
- Test: `src/ledger-routes-postgres.test.ts`

**Interfaces (all under `withTenant`):**
- `insertStepOutcome(pool, tenantId, input: StepOutcomeInput): Promise<{ id: string; duplicate: boolean }>` — `INSERT … ON CONFLICT (tenant_id, run_id, task_id, stage_key, dispatch_id) DO NOTHING RETURNING id`; when no row returned, select the existing id and return `duplicate: true`. On a non-duplicate insert call `upsertMemberStageStats(client, { tenantId, memberId, stageKey, projectId, accepted: outcome === 'succeeded' })` in the same transaction (`runs = runs + 1`, `accepted = accepted + $x`, `accept_rate = accepted::numeric / runs`). Skip stats when `memberId` is null (a bare Orca worker is not a member).
- `patchStepOutcomeSpend(pool, tenantId, id, patch: SpendPatch): Promise<boolean>`
- `insertStepVerification(pool, tenantId, input): Promise<{ id; duplicate }>` — `ON CONFLICT (tenant_id, dispatch_id, kind, name) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, required = EXCLUDED.required` (a re-run check may legitimately change status; not a ledger *outcome*), returns `duplicate: true` when the row pre-existed (`xmax <> 0` trick or a prior `SELECT`).
- `insertContextCapture(pool, tenantId, input): Promise<{ id; duplicate }>` — `prompt_bytes = Buffer.byteLength(prompt ?? '')`; conflict on `(tenant_id, dispatch_id)` → DO NOTHING.
- `getProvenance(pool, tenantId, { repoId, branch }): Promise<ProvenanceReport>` — outcomes and verifications for that repo+branch ordered by `created_at`, `contextCaptures` for those dispatch ids, totals, `reviewBackend.bypassed = any(outcomes.review_backend_bypass)`, `reviewBackend.enforced = !bypassed` (the ledger does not know the org policy; the desktop plan renders "enforced/bypassed" from this).
- `getRunCost(pool, tenantId, runId): Promise<RunCost>`.
- Routes: `POST /v1/ledger/step-outcomes` → 201 `{ id, duplicate: false }` or 200 `{ id, duplicate: true }`; `PATCH /v1/ledger/step-outcomes/:id/spend` → 200/404; `POST /v1/ledger/step-verifications` → 201/200; `POST /v1/ledger/context-captures` → 201/200, 413 `{ error: 'prompt_too_large' }` when zod rejects `prompt` length; `GET /v1/ledger/provenance?repoId=&branch=` → `ProvenanceReport`; `GET /v1/ledger/runs/:runId/cost` → `RunCost`. All behind `requireTenant`.

- [ ] **Step 1: Failing Postgres test** (this is the v0.1 exit criterion — "zero duplicates under induced retries"):
```ts
it('absorbs duplicate deliveries and keeps retries', async () => {
  const body = { runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'succeeded', memberId: 'm1', projectId: 'p1', repoId: 'r1', branch: 'feat/x' }
  const first = await post('/v1/ledger/step-outcomes', body)
  const again = await Promise.all([1, 2, 3].map(() => post('/v1/ledger/step-outcomes', body)))
  expect(first.status).toBe(201)
  expect(again.map((r) => r.status)).toEqual([200, 200, 200])
  const retry = await post('/v1/ledger/step-outcomes', { ...body, dispatchId: 'ctx_2', outcome: 'failed' })
  expect(retry.status).toBe(201)
  const { rows } = await withTenant(pool, 'org-1', (c) => c.query(`SELECT runs, accepted FROM member_stage_stats WHERE member_id = 'm1'`))
  expect(rows[0]).toEqual({ runs: 2, accepted: 1 })
})
it('assembles provenance for a branch', async () => { /* post 2 outcomes (one review_backend_bypass), 1 verification, 1 capture; GET provenance → totals.dispatches 2, reviewBackend.bypassed true, contextCaptures[0].promptBytes > 0 */ })
it('patches spend and reports run cost', async () => { /* PATCH spendCents 82 → GET /runs/run_1/cost totalSpendCents 82 */ })
it('rejects a capture over the size cap with 413', async () => { /* prompt of 65*1024 'x' */ })
it('rejects another tenant header', async () => { /* same GETs with x-alicorn-org acme → 403 */ })
it('keeps rows invisible outside the tenant transaction', async () => { /* pool.query without set_config → 0 rows; withTenant(pool,'other') → 0 rows */ })
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ledger-api): exactly-once step outcomes, verifications, context captures, provenance and cost reads`.

---

### Task 9 (A9): Local stack — compose, seed, CI wiring, docs

**Files:**
- Create: `cloud/dev/compose/alicorn-local.yml`, `cloud/dev/compose/desktop.env.example`
- Create: `cloud/dev/scripts/seed-alicorn-local.mjs`, `cloud/dev/scripts/seed-alicorn-local.test.mjs`
- Modify: `cloud/package.json` scripts (`alicorn:up`, `alicorn:down`, `alicorn:seed`, and add the seed test to the root `test` chain), `cloud/README.md`, `.github/workflows/cloud-verify.yml`

- [ ] **Step 1: compose file**
```yaml
name: alicorn-local
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: alicorn, POSTGRES_PASSWORD: alicorn, POSTGRES_DB: alicorn }
    ports: ["127.0.0.1:5432:5432"]
    volumes: [alicorn-pg:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U alicorn"], interval: 5s, timeout: 3s, retries: 20 }
  control-api:
    build: { context: ../.., dockerfile: apps/control-api/Dockerfile }
    environment:
      PORT: "8081"
      ALICORN_DATABASE_URL: postgres://alicorn:alicorn@postgres:5432/alicorn
      ALICORN_AUTH_MODE: local
      ALICORN_TENANT_ID: local
      ALICORN_LOCAL_API_TOKEN: ${ALICORN_LOCAL_API_TOKEN:-local-dev-token-change-me-0001}
    ports: ["127.0.0.1:8081:8081"]
    depends_on: { postgres: { condition: service_healthy } }
  ledger-api:
    build: { context: ../.., dockerfile: apps/ledger-api/Dockerfile }
    environment:
      PORT: "8082"
      ALICORN_DATABASE_URL: postgres://alicorn:alicorn@postgres:5432/alicorn
      ALICORN_AUTH_MODE: local
      ALICORN_TENANT_ID: local
      ALICORN_LOCAL_API_TOKEN: ${ALICORN_LOCAL_API_TOKEN:-local-dev-token-change-me-0001}
    ports: ["127.0.0.1:8082:8082"]
    depends_on: { postgres: { condition: service_healthy } }
volumes: { alicorn-pg: {} }
```
The default token is for the local stack only; the README says to export `ALICORN_LOCAL_API_TOKEN` for anything that leaves the laptop.

- [ ] **Step 2: seed script** `cloud/dev/scripts/seed-alicorn-local.mjs` — pure functions exported for the test, `main()` guarded by the `import.meta.url` check like the relay scripts:
  - `seedMembers(client: pg.Client, tenantId)`: inside one transaction `SELECT set_config('app.tenant_id', $1, true)` then upsert three members by name (`Developer/claude/worktree/accept_edits`, `Reviewer/codex/worktree/ask`, `QA/claude/worktree/ask`) with `created_by = 'seed'` and skills `['code-review']` for the Reviewer; idempotent (`ON CONFLICT DO NOTHING` needs a unique on `(tenant_id, name)` — add `CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_name ON members(tenant_id, name)` to A3's schema, which also makes the Members UI's duplicate-name error meaningful).
  - Connects with `ALICORN_DATABASE_URL` (default `postgres://alicorn:alicorn@127.0.0.1:5432/alicorn`, `search_path=control`).
  - Prints the three members and the env lines the desktop needs.
  - Test (`node --test`): `seedMembers` against a stubbed client records three inserts with the expected values; running it twice issues the same statements (idempotency is the DB's job, asserted in the Postgres suite of A5 via the unique index).
- [ ] **Step 3: `desktop.env.example`**
```bash
# Point the desktop at the local Alicorn control plane (dev builds only).
export ALICORN_CONTROL_API_URL=http://127.0.0.1:8081
export ALICORN_LEDGER_API_URL=http://127.0.0.1:8082
export ALICORN_TENANT_ID=local
export ALICORN_LOCAL_API_TOKEN=local-dev-token-change-me-0001
```
- [ ] **Step 4: Bring it up and prove it by hand** — `cd cloud && pnpm alicorn:up && pnpm alicorn:seed`; `curl -s http://127.0.0.1:8081/healthz` and `:8082/healthz` return ok; `curl -s -H "authorization: Bearer local-dev-token-change-me-0001" http://127.0.0.1:8081/v1/members | jq '.members | length'` → 3; without the header → 401. Record the outcome in the commit message body.
- [ ] **Step 5: (reserved)** — no realm import in this plan.
- [ ] **Step 6: CI** — in `.github/workflows/cloud-verify.yml` test job `env:` add `ALICORN_TEST_POSTGRES_URL: postgres://relay_test:relay_test@127.0.0.1:5432/orca_relay_test` (same service; our tests use their own schemas). Add the seed unit test to the root `pretest`/`test` chain in `cloud/package.json`. Add scripts: `"alicorn:up": "docker compose -f dev/compose/alicorn-local.yml up -d --build"`, `"alicorn:down": "docker compose -f dev/compose/alicorn-local.yml down"`, `"alicorn:seed": "node dev/scripts/seed-alicorn-local.mjs"`.
- [ ] **Step 7: README** — add an *Alicorn control plane* section to `cloud/README.md` (what the two services are, the compose command, the seed, the env example, the test env var).
- [ ] **Step 8: Commit** `feat(cloud): local Alicorn stack — Postgres, control/ledger APIs, seed`.

---

### Task 10 (A10): Bring ARCHITECTURE.md in line with what tier 1 built

Docs are authoritative; where this plan deviates deliberately, fix the doc rather than leave the code and the doc disagreeing.

**Files:** Modify `docs/alicorn/ARCHITECTURE.md`

- [ ] **Step 1: §6 Data model** — under `step_outcomes` add the tier-1 columns (`dispatch_id`, `backend`, `execution_strategy`, `worktree_id`, `branch`, `repo_id`, `review_backend_bypass`, `escalation_offered`, `escalation_accepted`, `usage`, `report_summary`) and change the key to `UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id)` with a one-line *why* (retries are new dispatches). Add `context_captures (id, tenant_id, run_id, task_id, dispatch_id, prompt | prompt_path, prompt_bytes, context_slice, created_at)`. Add `org_policies` and `project_required_checks` under *Product configuration* with the note "project-scoped until stages exist (v1.5); authored by an org admin, never by the member being judged." Leave the identity block as written and add above it: "*Status:* identity tables land with the Keycloak plan; tier 1 runs auth mode `local` with a constant `tenant_id`."
- [ ] **Step 2: §5 Identity** — add a *Status* line: "Deferred. Tier 1 authenticates with a shared bearer (`ALICORN_LOCAL_API_TOKEN`) and a constant tenant (`ALICORN_TENANT_ID`); the middleware seam (`requireTenant`) is where Keycloak plugs in. When it does: tenant id = Keycloak organisation id, proven by the token's `organization` claim."
- [ ] **Step 3: §6 rules** — add the outbox sentence: "The desktop enqueues each settled step in `ledger_outbox` inside the settlement transaction and a drainer posts it; the unique key absorbs replays." Note under *Offline writes reconcile* that tier 1 ships the outbox without a per-device sequence (server time still orders).
- [ ] **Step 4: INFRASTRUCTURE.md §7** — add: "Partitioning deferred: the exactly-once unique key must stay a single-table constraint; introduce monthly partitions with a side idempotency table when rows exceed ~10M."
- [ ] **Step 5: Commit** `docs(alicorn): align ARCHITECTURE with tier-1 ledger key, required-checks anchor and deferred identity`.

---

## Self-review

- **Spec coverage.** Members entity (A5). Ledger tables incl. `member_stage_stats`, exactly-once, server time (A7–A8). Required checks anchor + org policy for decision §11.4 (A6). `execution_strategy`, escalation flags, review bypass, context capture, spend — all carried by the ledger schema (A7/A8) for the desktop plan to write. Local env "one command + seed" (INFRASTRUCTURE §3) (A9). **Deferred by user decision:** identity (Keycloak, `/v1/desktop/auth/*`, relay tokens, org roles) — tracked as a follow-up plan. Corrections watcher, gate policy, board automation, workflows: out of scope (v0.1/v1.0/v1.5 base, not tier 1).
- **Placeholders.** Every route has a body, a status and a test. A5/A6/A8 give SQL shapes and test assertions rather than full route bodies — acceptable because each mirrors the fully written A4 middleware and A3 skeleton in the same package; if an executor finds that insufficient, expand inline rather than improvise a different structure.
- **Type consistency.** `requireTenant` sets `c.get('auth')` as `{ tenantId, actor }` in both apps; `withTenant(pool, tenantId, fn)` everywhere; `insertStepOutcome` returns `{ id, duplicate }` and the route maps `duplicate` to 200 vs 201 — the desktop drainer treats both as success. The unique index `members(tenant_id, name)` is created in A3 and relied on by A9's seed.
- **Order.** A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10.
