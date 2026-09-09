import { tenantRlsPolicySql } from '@alicorn-cloud/control-plane-postgres'

// Identity (I3). The whole point of these four tables: everything internal keys off `users.id`,
// never the IdP subject. The subject appears exactly once — as half of the lookup pair on `users`
// — and is referenced by no foreign key anywhere.
//
// Which of them are tenant-scoped, and why only one carries forced RLS:
//   `tenants`        is the tenant *directory*. A row is a tenant; it is what `tenant_id` points
//                    at. Scoping it to a tenant would also break alias resolution, which by
//                    definition runs before a tenant has been chosen.
//   `users`          is one human across every organisation they belong to. A user row scoped to
//                    a tenant would have to be duplicated per organisation, and the duplicate ids
//                    would sign the desktop out on every organisation switch.
//   `cloud_profiles` is one profile per user (`/profile` answers 501, so the desktop can never
//                    create a second), so it follows `users`.
//   `org_roles`      is the membership — the only genuinely tenant-scoped row here, and the one
//                    that answers "who is in this organisation". RLS is forced on it, so a tenant
//                    can never see another tenant's membership, not even as the owning role.
//
// Deliberate divergence from plans/2026-09-06-identity-keycloak.md Task 3, which put no RLS on
// any of the four: CLAUDE.md's invariant is `tenant_id` on every tenant-scoped row *with forced
// RLS*, and "who is in this organisation" is the most sensitive thing here. The price is that a
// membership can only be read or written inside its own tenant's scope, so nothing enumerates a
// user's organisations from the database — and nothing needs to, because the presented token
// proves them. The plan's cross-tenant `DELETE org_roles … WHERE tenant_id <> ALL(...)` prune is
// therefore not possible and not built; a stale row grants nothing (see below), and reaping one
// is an operator sweep for OP1.
export const IDENTITY_SCHEMA_STATEMENTS: readonly string[] = [
  // `id` is the organisation id from the token I2 verified — consumed, never re-derived here.
  // `alias` is nullable and unique: Keycloak guarantees one alias per organisation per realm, and
  // a token that moves an alias to another organisation releases it from the old row first.
  `CREATE TABLE IF NOT EXISTS tenants (
     id TEXT PRIMARY KEY,
     alias TEXT,
     name TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tenants_alias ON tenants(alias) WHERE alias IS NOT NULL`,
  // Why the id is minted here and not derived: a digest of `sub` is still the subject wearing a
  // hat — reproducible by anyone holding the subject, and it moves the moment the realm re-issues
  // one. Postgres mints a random id once; `idp_subject` is only ever a lookup key.
  //
  // Why the issuer is recorded but is *not* part of that key: Keycloak's `sub` is a per-realm
  // UUID, so a collision across realms is not a real hazard — whereas moving the realm's public
  // URL (localhost → the company domain) is an ordinary Tuesday, and keying on it would sign
  // every user out and orphan every row they own.
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY DEFAULT ('usr_' || gen_random_uuid()::text),
     idp_subject TEXT NOT NULL UNIQUE,
     idp_issuer TEXT NOT NULL,
     email TEXT NOT NULL,
     display_name TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // The `organization` claim carries no role, so the first person to sign in for an organisation
  // bootstraps as its owner and everyone after them is a member — replaced by real assignment
  // when OP1 lands org administration. It is never read for *authorisation*: membership is
  // re-proven from the presented token on every call, so a stale row can only ever under-grant.
  `CREATE TABLE IF NOT EXISTS org_roles (
     tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
     granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS org_roles_user ON org_roles(user_id)`,
  tenantRlsPolicySql('org_roles'),
  // `active_tenant_id` is a remembered *preference*, not a grant: it is honoured only while the
  // presented token still proves that membership, and rewritten to a proven one when it does not.
  `CREATE TABLE IF NOT EXISTS cloud_profiles (
     id TEXT PRIMARY KEY DEFAULT ('prf_' || gen_random_uuid()::text),
     user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
     local_profile_id TEXT,
     active_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
     linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
]
