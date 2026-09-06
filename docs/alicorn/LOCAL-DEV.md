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
