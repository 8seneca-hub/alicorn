# Deployment — what to create, in what order, before the first real test

Everything in this file is a value or an account someone has to create. Nothing here can be done by
a commit, which is why it is a document rather than a ticket.

The order matters: each phase's checks pass only if the phase before it is done. Phase 1 gets a
working local product with no external accounts at all, so **start testing there** rather than
waiting on certificates.

---

## 0. Identity values already fixed in code

Do not invent variants of these. They are set, and other things key off them.

| Value | Setting | Where it lives |
|---|---|---|
| Bundle / app id | `com.8seneca.alicorn` | `config/electron-builder.config.cjs` |
| Product name | `Alicorn` | same |
| Protocol schemes | `alicorn`, and `orca` for one release | same |
| CLI command | `alicorn` (macOS/Windows), `alicorn-ide` (Linux) | `src/shared/alicorn-cli-command-name.ts` |
| Dev CLI command | `alicorn-dev`, with `orca-dev` aliased | `config/scripts/alicorn-dev.mjs` |
| Release repository | `8seneca-hub/alicorn` | `src/shared/release-feed-repositories.ts` |
| OAuth client id | `alicorn-desktop` | `profile-cloud-auth-config.ts` |
| Upstream cut | `436ef827d`, v1.4.198 | `UPSTREAM_BASE` |

**The app id is a clean install, not an update.** It moved from the Orca id, so an existing Orca
install is not upgraded in place — the two coexist. That is deliberate; do not "fix" it by
reverting the id.

---

## 1. Local — no accounts needed, test today

```bash
corepack enable && corepack prepare pnpm@10.24.0 --activate   # cloud/ needs pnpm 10
pnpm install
pnpm alicorn:up && pnpm alicorn:seed                          # Postgres 16 + both APIs + 3 members
pnpm dev
```

**Corrections from actually running it on 2026-09-10** — the three lines above were written from
the plans rather than from a terminal, and two of them were wrong:

- **`alicorn:up` / `alicorn:seed` live in `cloud/package.json`, not the root.** It is
  `cd cloud && pnpm alicorn:up`.
- **`cloud/` declares `engines.pnpm >= 10`**, so on a pnpm 9 machine that command refuses to run
  before it does anything. Either take the corepack line above seriously, or drive compose
  directly, which has no such gate:
  ```bash
  cd cloud
  docker compose -f dev/compose/alicorn-local.yml up -d --build
  node dev/scripts/seed-alicorn-local.mjs
  ```
- **The ledger API will not start until you give it a signing key.** The compose file defaults
  `ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID` and `_PEM` to empty, the service validates them as
  non-empty, and the container exits 1 — leaving three of four services up and one silently gone.
  Generate a throwaway pair first:
  ```bash
  openssl ecparam -name prime256v1 -genkey -noout -out /tmp/alicorn-ledger-dev.pem
  export ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID=local-dev
  export ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM="$(cat /tmp/alicorn-ledger-dev.pem)"
  ```
  Export it in the shell rather than writing it to `cloud/.env`: compose's `.env` parser does not
  handle a multi-line PEM, and it fails by passing an empty string rather than by complaining.
  This key signs provenance exports — a local throwaway is fine, reusing it anywhere real is not.

`docker compose ... ps -a` after starting, not `ps`. A service that exited is invisible in the
default listing, which is exactly how the missing ledger key reads as a clean startup.

Environment for the desktop, auth mode `local` — one tenant, one shared bearer, no Keycloak:

| Variable | Value |
|---|---|
| `ALICORN_TENANT_ID` | `local` |
| `ALICORN_LOCAL_API_TOKEN` | any long random string, same on desktop and services |
| `ALICORN_CONTROL_API_URL` | `http://127.0.0.1:8081` |
| `ALICORN_LEDGER_API_URL` | `http://127.0.0.1:8082` |
| `ALICORN_DATABASE_URL` | from `cloud/dev/compose` |
| `ALICORN_TEST_POSTGRES_URL` | same; **without it the Postgres suites skip rather than fail, which reads as green** |

**This is the phase where the product is actually exercisable.** Members, the ledger, gates,
required checks, workflows and the Foreman journal all work here. Nothing below is needed to
find out whether the thing is any good.

---

## 2. DNS — six records you must create

One zone, one label each. The code already points at these (BC2); until they resolve, a packaged
build's auth, relay and artifacts reach nothing.

| Host | Serves |
|---|---|
| `login.alicorn.8seneca.com` | Keycloak — desktop sign-in |
| `api.alicorn.8seneca.com` | Control API + Ledger API |
| `relay.alicorn.8seneca.com` | Relay director |
| `relay-c1.alicorn.8seneca.com` | Relay cell 1 (add `-c2`… as cells grow) |
| `share.alicorn.8seneca.com` | Artifacts |
| `www.alicorn.8seneca.com` | Docs — every in-app help link resolves here |

TLS on all six. `www` matters more than it looks: the feature wall, the help menu and the telemetry
privacy link all point into `/docs/...`, so a missing docs site is visible on first launch.

---

## 3. GitHub — one rename that unblocks a gate

**Rename the repository secret** `ORCA_POSTHOG_WRITE_KEY` → `ALICORN_POSTHOG_WRITE_KEY`.

The workflows already read `ALICORN_… || ORCA_…`, so this is safe at any moment and the old secret
can be deleted a release later. Do it and `verify:rebrand-env-gate` reaches baseline 0 — the last
two rows in the whole rebrand.

A reference to a secret that does not exist resolves to the empty string with **no error**, which
is why both names are read rather than cut over blind.

---

## 4. Identity — Keycloak

Auth mode `keycloak` is built and behind the same middleware seam as `local`; it is configuration,
not code.

| Variable | Note |
|---|---|
| `ALICORN_AUTH_MODE` | `keycloak` |
| `ALICORN_KEYCLOAK_ISSUER` | `https://login.alicorn.8seneca.com/realms/alicorn` |
| `ALICORN_KEYCLOAK_INTERNAL_ISSUER` | in-cluster URL, if it differs |
| `ALICORN_KEYCLOAK_ADMIN_PASSWORD` | from your secret store, never a file |
| `ALICORN_DESKTOP_CLIENT_ID` | `alicorn-desktop` — public client, PKCE, loopback redirect |
| `ALICORN_LEDGER_EXPORT_SIGNING_KEY_ID` / `_PEM` | ES256 keypair for signed provenance exports |

Create the realm `alicorn` and the public client `alicorn-desktop`. Organisations map to tenants;
`tenant_id` is on every row with RLS forced, so this is a second auth mode, not a migration.

---

## 5. Relay — BC1, and the cycle to break

The relay still uses `ORCA_RELAY_*` deliberately: CLAUDE.md scopes that rename to BC1, and renaming
it piecemeal makes the env gate lie.

**I5 and BC1 each list the other as a dependency, which cannot be true.** Break it in three steps:

1. **BC1a** — relay up on our infrastructure in **staging**, existing auth, new `project_id` and
   `name_prefix: alicorn-cloud` in `cloud/infra/terraform/environments/`.
2. **I5** — Control API mints ES256 relay tokens and publishes JWKS.
3. **BC1b** — point the relay at our JWKS, cut production over, then rename `ORCA_RELAY_*` →
   `ALICORN_RELAY_*` and drop the relay allowlist from `verify-rebrand-env-gate.mjs`.

Terraform state bucket is new too (`backend/*.hcl`).

---

## 6. Signing — the long pole, start it first

Neither is engineering work and both have lead times measured in weeks.

- **Apple Developer ID** — enrolment, then `APPLE_TEAM_ID`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`, `CSC_KEY_PASSWORD` as repository secrets. Verify with
  `spctl -a -vv` on the notarised, stapled `.dmg`.
- **Windows code signing via SignPath** — organisation, project and policy slugs as secrets, and
  `win.signtoolOptions.publisherName` set to the new identity **only in the release that ships with
  the new SignPath project**. Verify with `Get-AuthenticodeSignature`.

Unsigned Windows installers are SmartScreen-blocked, which reads as malware to a buyer. ROADMAP
puts this at week 0 for that reason; it is the item most likely to set the launch date.

- **Linux** needs no certificate. Keep the glibc 2.31 floor; packaging fails if a bundled native
  binary needs newer.

---

## 7. Brand assets — the remaining artwork

Icons and wordmark (R1). Everything else about product identity is done; these are files a designer
produces, and the `NOTICE` legal entity line still says *to be confirmed*.

---

## Order of work

```
now      ├─ Phase 1 local ......... test the actual product
week 0   ├─ Apple + SignPath ...... longest lead, not engineering
         ├─ PostHog secret rename . one minute, closes the last gate row
week 1   ├─ DNS (6 records) ....... unblocks packaged builds
         ├─ Keycloak realm ........ desktop sign-in
week 2   ├─ BC1a → I5 → BC1b ...... relay, in that order
week 3   └─ first signed release .. publish to 8seneca-hub/alicorn
```

The first signed release is also the moment the dual update feed earns its keep: it publishes to
the Alicorn repository while still reading the Orca one, so a pre-rebrand install is carried across
exactly once.
