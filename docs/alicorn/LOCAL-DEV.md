# Local development — desktop against the local Alicorn stack

How to run Alicorn Desktop against the local control plane: Postgres, the Control API and the
Ledger API from [`cloud/dev/compose/alicorn-local.yml`](../../cloud/dev/compose/alicorn-local.yml).

## Prerequisites

- **Node 24** — `nvm install 24 && nvm use 24` (the repo pins it in `.node-version`).
- **pnpm** — `corepack enable && corepack prepare pnpm@latest --activate`.
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

## Environment

Read only through `src/main/alicorn/control-plane-urls.ts` and `control-plane-session.ts`; nothing
else reads these variables directly.

| Variable | Meaning |
|---|---|
| `ALICORN_CONTROL_API_URL` | Control API base — members, org policy, required checks. Required. |
| `ALICORN_LEDGER_API_URL` | Ledger API base. Optional; defaults to the Control API URL. |
| `ALICORN_LOCAL_API_TOKEN` | Shared bearer for auth mode `local`. Must be at least 16 characters. |
| `ALICORN_TENANT_ID` | Constant tenant. Optional; defaults to `local`. |

Both URLs must parse as `http(s)`, and trailing slashes are stripped so paths append cleanly.

## How the desktop reaches the control plane

Every call goes through `alicornFetch(service, path, init)` in
`src/main/alicorn/control-plane-http.ts` — the members client (B2) and the ledger writer (C3) both
build on it and neither imports the other. It adds the bearer, `x-alicorn-org`, JSON headers and a
15 s timeout, and refuses to follow redirects so a misconfigured deployment cannot replay the
credential at another host.

Two failures are worth recognising:

- **`ControlPlaneUnavailableError('control_plane_unconfigured')`** — the URLs or the token are
  missing or malformed. Nothing was sent. Re-`source` the env file.
- **`ControlPlaneRequestError(status, code)`** — the control plane answered and refused. `code` is
  the JSON body's `error` field when present, otherwise the status text.

Identity is deferred: when Keycloak lands (I4), only the body of `readAlicornBearer` changes.

## Verify

```sh
pnpm test src/main/alicorn
pnpm tc:node
```

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
2. `source cloud/dev/compose/desktop.env.example && pnpm dev`.
3. Settings → Workflows → Members → three seeded members; create *Reviewer B* (codex); quit and relaunch — it is still there (Postgres, not local).
4. CLI: `task-create` → `worker-start --member <Developer>` → worker sends `worker_done --phase build` → provenance endpoint shows the outcome with `backend claude`, `execution_strategy single`, a context capture, and (after ~1 min) `spend_cents`.
5. `worker-start --member <Reviewer on claude>` on a dependent task → rejected `reviewer_backend_conflict`; with `--allow-same-backend-review` → allowed; ledger row `review_backend_bypass true`.
6. Push the branch, create a PR from the sidebar → PR body has the Provenance section with the bypass warning and the diff-coverage line (after configuring the project's required check).
7. Sidebar agent row shows `$0.xx` while a Claude worker runs.
8. Kill the desktop between `worker_done` and the drainer's next tick (stop the Ledger API first so the send fails, then quit the app, restart both) → the outcome is delivered once; `SELECT count(*) FROM step_outcomes WHERE dispatch_id = …` is 1. Then `orca ledger outbox` shows no dead rows — a row here means the Ledger API rejected it permanently, and `orca ledger outbox --dead` explains why.
