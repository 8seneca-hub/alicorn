# Local development — desktop against the local Alicorn stack

How to run Alicorn Desktop against the local control plane: Postgres, the Control API and the
Ledger API from [`cloud/dev/compose/alicorn-local.yml`](../../cloud/dev/compose/alicorn-local.yml).

## Prerequisites

- **Node 24** — `nvm install 24 && nvm use 24` (the repo pins it in `.node-version`).
- **pnpm** — `cloud/` pins `pnpm@10.24.0` and enforces `engines.pnpm >= 10`, while the desktop root
  pins a different version. Do not install one pnpm globally and hope; let Corepack resolve the pin per
  directory. If a global `pnpm -v` reports below 10, `cd cloud && corepack pnpm install` still works,
  but any script that shells out to a bare `pnpm` (notably every `pretest`) will use the global one and
  fail with `ERR_PNPM_UNSUPPORTED_ENGINE`. Put a Corepack shim first on `PATH` for cloud work:

  ```sh
  corepack enable --install-directory cloud/.pnpm-shim pnpm   # once; .pnpm-shim is gitignored
  export PATH="$PWD/cloud/.pnpm-shim:$PATH"                   # per shell, while working in cloud/
  ```

  This leaves the global `pnpm` — and the desktop build — untouched.

  **The desktop root has the same mismatch with a worse failure.** It pins `pnpm@12.0.0`. Running
  `pnpm install` at the root with an older global pnpm does not warn and does not fail — it rewrites
  `pnpm-lock.yaml` wholesale (~2900 lines each way, a lockfile-format downgrade) *and* resolves
  different package versions than the lockfile pins. Observed 2026-09-08 installing with 9.15.0 and
  then correcting with 12.0.0: `zustand` moved 5.0.15 → 5.0.14. So the wrong-pnpm install is not
  cosmetic, and if the lockfile churn is ever committed it takes the whole team's resolutions with it.

  At the root, use `corepack pnpm install --frozen-lockfile`. `--frozen-lockfile` is the part that
  matters: it makes an accidental rewrite an error instead of a silent diff.
- **Docker** with Compose, running.

## 1. Bring the stack up

```sh
cd cloud
pnpm install
pnpm alicorn:up      # Postgres + control-api + ledger-api
pnpm alicorn:seed    # three members in the constant local tenant
```

Port 5432 already taken? Bring it up on another port — the APIs stay on 8081/8082 either way:

```sh
ALICORN_PG_PORT=5434 pnpm alicorn:up
```

Check it answers:

```sh
curl -s localhost:8081/healthz && curl -s localhost:8082/healthz
```

`pnpm alicorn:down` stops it again.

## 2. Point the desktop at it

```sh
source cloud/dev/compose/desktop.env.example
cd .. && pnpm dev
```

**Expected result:** Settings → Workflows → Members lists the three seeded members.

## 2b. Keycloak mode instead of the shared token

Both auth modes are supported. Auth mode `local` above is what tier 1 runs; `keycloak` is the
second mode, and the stack and the desktop must be in the same one.

```sh
cd cloud
ALICORN_AUTH_MODE=keycloak pnpm alicorn:up     # first Keycloak boot takes about a minute
pnpm alicorn:verify-keycloak
```

**The organisation is still manual.** `dev/keycloak/alicorn-realm.json` imports the realm, the
`alicorn-desktop` client (with `organization` as a default client scope) and the user `dev`/`dev`,
but no organisation — seeding one is the identity plan's last task and has not landed. Until it
does, in the admin console at `http://127.0.0.1:8080` (`admin`/`admin`), realm `alicorn`:
Organizations → create **Acme** (alias `acme`, domain `acme.test`) → Members → add `dev`. Copy the
organisation's id from its URL.

The tenant in keycloak mode *is* that organisation id, so seed the members into it rather than
into `local`:

```sh
ALICORN_TENANT_ID=<organisation id> pnpm alicorn:seed
```

Then, **in a fresh shell** — the two env blocks must not both be set:

```sh
source cloud/dev/compose/desktop.keycloak.env.example
pnpm dev
```

Settings → Orca Account → Connect → sign in as `dev`/`dev` → the profile shows organisation
**Acme**. Settings → Workflows → Members then lists the seeded members, which is the end-to-end
proof: the session's access token and that organisation's id travelled together to the Control
API and passed `requireTenant` in keycloak mode. An empty list with `403 not_a_member` means the
members were seeded into a different tenant than the one the token proves.

Why a fresh shell rather than one file with both blocks: `ALICORN_LOCAL_API_TOKEN` left over from
the `local` block makes the desktop choose `local` mode when `ALICORN_AUTH_MODE` is absent, and
present the shared token to a stack that only accepts Keycloak ones. That is a 401 that reads like
a sign-in bug.

## Environment

Read only through `src/main/alicorn/control-plane-urls.ts` and `control-plane-session.ts`; nothing
else reads these variables directly.

| Variable | Meaning |
|---|---|
| `ALICORN_AUTH_MODE` | `local` or `keycloak`. Optional; see the mode rule below. |
| `ALICORN_CONTROL_API_URL` | Control API base — members, org policy, required checks. Required. |
| `ALICORN_LEDGER_API_URL` | Ledger API base. Optional; defaults to the Control API URL. |
| `ALICORN_LOCAL_API_TOKEN` | Shared bearer for auth mode `local`. Must be at least 16 characters. |
| `ALICORN_TENANT_ID` | Constant tenant for auth mode `local`. Optional; defaults to `local`. Ignored in `keycloak` mode. |

Keycloak mode reads the desktop's existing Orca Cloud sign-in, so it also uses that flow's
pre-rebrand `ORCA_CLOUD_*` variables (`profile-cloud-auth-config.ts`), of which three matter here:

| Variable | Meaning |
|---|---|
| `ORCA_CLOUD_API_URL` | Where `/v1/desktop/auth/*` lives — the Control API, which brokers Keycloak. |
| `ORCA_CLOUD_CLIENT_ID` | The public PKCE client, `alicorn-desktop`. |
| `ORCA_CLOUD_AUTHORIZE_URL` | Keycloak's own realm authorize endpoint. The broker does not serve `/authorize`, so leaving this unset points the browser at a route that does not exist. |

Both control-plane URLs must parse as `http(s)`, and trailing slashes are stripped so paths append
cleanly. Loopback HTTP `ORCA_CLOUD_*` endpoints are accepted only in unpackaged builds.

## Which mode the desktop picks

`resolveAlicornAuthMode` in `control-plane-session.ts`:

1. `ALICORN_AUTH_MODE=local` or `=keycloak` wins outright.
2. Unset — `ALICORN_LOCAL_API_TOKEN` present means `local`, absent means `keycloak`.

A mode never borrows the other's credential. In `keycloak` mode a missing or expired session is
`control_plane_unconfigured`, **not** a quiet fall back to the shared token: a token the server
cannot place is a much worse failure to debug than "sign in again". Symmetrically, `local` mode
never reads the session store.

## What `x-alicorn-org` carries, and why it must agree

The org header is a cross-check, not an instruction. In `keycloak` mode the server takes the
organisations the *token* proves and uses the header only to select which of them to act as — a
header naming an organisation the token does not carry is `403 not_a_member`, and no header at all
is `400 org_header_required`. So the desktop reads the org from the same place as the token: the
signed-in profile's `activeOrgId`, never `ALICORN_TENANT_ID`. If a refresh or an org switch changes
the linkage while the call is in flight, `readAlicornBearer` returns null rather than pairing the
new token with the old org.

## How the desktop reaches the control plane

Every call goes through `alicornFetch(service, path, init)` in
`src/main/alicorn/control-plane-http.ts` — the members client (B2) and the ledger writer (C3) both
build on it and neither imports the other. It adds the bearer, `x-alicorn-org`, JSON headers and a
15 s timeout, and refuses to follow redirects so a misconfigured deployment cannot replay the
credential at another host.

Two failures are worth recognising:

- **`ControlPlaneUnavailableError('control_plane_unconfigured')`** — no credential was produced,
  so nothing was sent. In `local` mode: the URLs or the token are missing or malformed —
  re-`source` the env file. In `keycloak` mode it means the same *or* that nobody is signed in;
  the one code covers both today, so check Settings → Orca Account before the env file.
- **`ControlPlaneRequestError(403, 'not_a_member')`** — the token and `x-alicorn-org` disagreed.
  Usually a stale `ALICORN_LOCAL_API_TOKEN`/`ALICORN_TENANT_ID` pair left in the shell, or an org
  switched in another window. Restart from a fresh shell.
- **`ControlPlaneRequestError(status, code)`** — the control plane answered and refused. `code` is
  the JSON body's `error` field when present, otherwise the status text.

`readAlicornBearer` is where both modes are decided; it is the only thing that changed on the
desktop when Keycloak landed (I4). It is `async` since then, because a Keycloak session may need
a refresh before it can be presented.

## Verify

Desktop side:

```sh
pnpm test src/main/alicorn
pnpm tc:node
```

Cloud side — **the Postgres suites skip without a database, and a skip is not a pass.** Check the run
count, not the colour: with no `ALICORN_TEST_POSTGRES_URL`, `control-api` reports 12 passed and
51 *skipped*, and `ledger-api` 12 passed and 21 *skipped*, while still exiting 0.

The URL must be a **superuser** — the suites create their own non-superuser roles and schemas to prove
forced RLS — and it should point at a throwaway database, not the dev stack's `alicorn` on 5432, since
the tests create and drop roles.

```sh
docker run -d --name alicorn-test-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:16-alpine       # once
docker exec alicorn-test-pg psql -U postgres -c 'create database alicorn_test'

cd cloud
export PATH="$PWD/.pnpm-shim:$PATH"
export ALICORN_TEST_POSTGRES_URL="postgres://postgres:postgres@127.0.0.1:5433/alicorn_test"
pnpm -r build          # apps import the packages' dist, so build before typecheck or test
pnpm -r typecheck
pnpm -r test
```

Fully wired, nothing is skipped: `control-api` 116, `ledger-api` 65, `control-plane-contract` 96,
`control-plane-auth` 35 and `control-plane-postgres` 5 (measured 2026-09-09). The two contract and
auth packages need no database at all — `pnpm --filter @alicorn-cloud/control-plane-auth test`
runs on its own.

## Board automation — automated live check

The manual checklist below is a one-off; this is the repeatable part. It runs the real rule engine
against a real SQLite orchestration database and a real Control API over HTTP, with only
`startWorkerForTask` stubbed (launching an agent needs an Electron runtime and real terminals).

```bash
cd cloud && pnpm alicorn:up && pnpm alicorn:seed
cd .. && ALICORN_TEST_CONTROL_API_URL=http://127.0.0.1:8081 \
  pnpm test src/main/board-automation/board-automation-live.integration.test.ts
```

It skips cleanly without `ALICORN_TEST_CONTROL_API_URL`, so CI is unaffected. Overridable:
`ALICORN_TEST_CONTROL_API_TOKEN`, `ALICORN_TEST_CONTROL_API_TENANT`,
`ALICORN_TEST_CONTROL_API_PROJECT`.

It exists because every defect this feature shipped was at a boundary the unit tests mocked — a
SQLite timestamp parsed as local time, a SQL comparison between two timestamp formats, and stage
keys that share nothing with board column ids. All three passed a green unit suite. The check also
proved itself on its first run, by failing on a branch whose base was missing the column binding.

## Smoke checklist (tier 1)

Results are recorded in the PR description or the Plane issue (E1 / ALC-27) when the run is performed manually.

1. `cd cloud && pnpm alicorn:up && pnpm alicorn:seed` → both `/healthz` ok; seed prints org id.
2. `source cloud/dev/compose/desktop.env.example && pnpm dev`. (Keycloak mode: follow §2b instead, then connect as `dev`/`dev` before step 3.)
3. Settings → Workflows → Members → three seeded members; create *Reviewer B* (codex); quit and relaunch — it is still there (Postgres, not local).
4. CLI: `task-create` → `worker-start --member <Developer>` → worker sends `worker_done --phase build` → provenance endpoint shows the outcome with `backend claude`, `execution_strategy single`, a context capture, and (after ~1 min) `spend_cents`.
5. `worker-start --member <Reviewer on claude>` on a dependent task → rejected `reviewer_backend_conflict`; with `--allow-same-backend-review` → allowed; ledger row `review_backend_bypass true`.
6. Push the branch, create a PR from the sidebar → PR body has the Provenance section with the bypass warning and the diff-coverage line (after configuring the project's required check).
7. Sidebar agent row shows `$0.xx` while a Claude worker runs.
8. Kill the desktop between `worker_done` and the drainer's next tick (stop the Ledger API first so the send fails, then quit the app, restart both) → the outcome is delivered once; `SELECT count(*) FROM step_outcomes WHERE dispatch_id = …` is 1. Then `orca ledger outbox` shows no dead rows — a row here means the Ledger API rejected it permanently, and `orca ledger outbox --dead` explains why.
