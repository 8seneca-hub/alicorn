# Plane REST API — what the provider had to work around

Notes taken while building the Plane provider (PP1–PP3). They record the parts of Plane's v1
REST API that shaped the implementation, so the next person changing `src/main/plane/**` does
not rediscover them.

> **Not verified against a live deployment.** Everything here is derived from Plane's published
> API surface and from the shapes the client already parses. No request has yet been made to
> `https://projects.8seneca.com` from this code. Treat the *behaviours* below as design
> constraints we committed to, and re-check them the first time the provider runs for real.

## Authentication

One workspace-scoped API key per (deployment, workspace), sent as `X-API-Key`. There is no
`Authorization: Bearer` form for API keys. A "connection" in Alicorn is therefore the pair
`(baseUrl, workspaceSlug)` — `src/main/plane/plane-request.ts`.

The key lives in the execution host's secret store and never crosses the wire to a paired
client, which is why every Plane read and write is an RPC to the host rather than a renderer
fetch.

## The route rename

Plane v1.1.0 renamed the issue routes from `/issues/` to `/work-items/`. Both resolve on current
releases; `/work-items/` 404s on v1.0.0 and older, and `/issues/` is marked deprecated in Plane's
source and is no longer documented.

`plane-issue-endpoint.ts` probes `/work-items/` once per connection and remembers the answer for
an hour, falling back to `/issues/`. The probe keys on the connection id because two deployments
can be different Plane versions.

**The known cost:** Plane answers "this route does not exist" and "this work item does not exist"
with the same 404, so a detail read for a genuinely missing issue can be misread as a missing
route. That is tolerated deliberately — the fallback resolves on every release, so the price is
one extra request and an hour on the older path, and the 404 still reaches the caller either way.

Every issue-scoped call must go through `withIssueSegment`, including comments and writes. A new
call that hardcodes a segment will work on your deployment and break on someone else's.

## No cross-project issue list

There is no workspace-wide issue route. Consequences, all of which are visible in the product:

- The task page is a project **selector**, not a fan-out. Fanning out would multiply every page
  load by the project count against a 60 req/min budget.
- The chosen project is persisted on the connection (`defaultProjectId`).
- `orca plane search` requires `--project`.
- A readable id (`ALC-11`) is resolvable because the project key is embedded in it: find the
  project by key, then the issue by its running number. A bare **uuid** is not resolvable without
  a project, which is why `orca plane issue <uuid>` requires `--project`
  (`plane-issue-resolver.ts`).

## No server-side filtering in CE

Plane Community Edition ignores filter query parameters rather than rejecting them, so a request
that looks filtered silently returns everything. `order_by` is likewise allowlisted server-side
and falls back to the default for anything unrecognised — an unsupported ordering is not an
error, it is ignored.

The provider therefore filters locally (`plane-issue-search.ts`) and does not send filters it
cannot rely on. `--limit` caps the *output*, not the fetch: a large project still pays the full
page walk.

## Pagination and response shapes

List endpoints are cursor-paginated with a `value:offset:is_prev` cursor
(`plane-record-pages.ts`). Two shapes to watch:

- **Some endpoints return a bare array rather than a paginated envelope.** Workspace members is
  one. `fetchAllPages` returned empty against it until that was handled — a silent wrong answer,
  not an error.
- **The same field is a bare uuid on detail reads and an object on list reads.** `state`,
  `project` and `parent` all do this, which is why relation ids go through one coercion
  (`toRelationId` in `plane-issue-queries.ts`). Priority does the same, arriving either as a
  string or as `{ id, label, key }`.

`created_at` / `updated_at` are deliberately **not** defaulted to now when absent — reporting that
read them would silently record the fetch time as the issue's timestamps.

## States: the group is stable, the name is not

A state carries both a display `name` and a `group`
(`backlog` | `unstarted` | `started` | `completed` | `cancelled`). Names are per-project and
user-editable; groups are not. Everything automated keys off the group:

- The sidebar badge takes its tone from the group, unlike Linear's which must pattern-match a name.
- `orca plane search --state` takes a group.
- The board write-back maps a column to a group first, and only falls back to an exact name match.

**Plane has no review group.** Review states live in `started` alongside the working ones, so the
two are told apart by name — the one place the provider must read a user-editable string. Where
that leaves zero or several candidates, nothing is written. See
`sync-plane-worktree-status.ts`.

## Writes

Only two, both partial updates:

- **State**: `PATCH` with `{ state }` alone, so a board move cannot clobber a concurrent edit to
  any other field.
- **Comments**: `POST` to the issue's `comments/` with `comment_html`. Plane stores comment
  bodies as HTML. The CLI escapes and paragraph-wraps the body rather than half-converting
  markdown, which reads worse on a board than the source text, and strips tags on the way out
  because the CLI has no DOM.

Errors come back in DRF's shape — either `{ detail }` / `{ error }` / `{ message }`, or field
errors as `{ field: ["msg", ...] }`. `readPlaneError` handles both; a write that reports success
on a rejected PATCH is the failure mode to avoid.

## Rate limit

60 requests per minute per key. The provider spends it on: a project list, a project's issue
list, and a project's states. `orca plane issue ALC-11` costs a project list plus an issue list,
because of the missing cross-project route above.
