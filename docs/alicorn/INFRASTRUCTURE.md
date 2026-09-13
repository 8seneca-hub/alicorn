# Alicorn — Infrastructure

## 1. Deployment models

Two, from one set of container images and one Helm chart. The difference is configuration, not code.

|          | **Customer self-hosted**             | **Alicorn Cloud**                       |
| -------- | ------------------------------------ | --------------------------------------- |
| When     | v1, the default                      | v2, once demand exists                  |
| Tenancy  | One organisation per deployment      | Many, isolated by `tenant_id` + RLS     |
| Runs on  | Customer's Kubernetes or a single VM | Managed Kubernetes, one region to start |
| Data     | Never leaves customer infrastructure | Regional, with residency options        |
| Upgrades | Customer-driven, Helm chart          | Continuous                              |

The schema is multi-tenant from day one. In a self-hosted deployment `tenant_id` is a constant. This
is what makes Alicorn Cloud a configuration change rather than a migration.

## 2. Runtime

**Kubernetes, with a single-VM path for small customers.**

```
Namespace: alicorn
  keycloak        Deployment  2 replicas   stateless
  control-api     Deployment  2 replicas   stateless
  ledger-api      Deployment  2 replicas   stateless
  relay           StatefulSet 2 replicas   sticky sessions
  postgres        CloudNativePG cluster    1 primary + 1 replica
  redis           Deployment  1 replica    relay presence only
  ingress         nginx / Traefik          TLS via cert-manager
```

- **Postgres via CloudNativePG.** Gives declarative clusters, streaming replicas, scheduled base
  backups and point-in-time recovery to object storage without operating any of it by hand.
- **Relay is the only sticky component.** WebSocket connections pin to a pod; scale by connections,
  not CPU.
- **Everything else is stateless.** Horizontal scaling is a replica count.
- **Small deployments** (under ~25 seats) run the same images under Docker Compose with a single
  Postgres. Publish this as the supported starting point; most first customers will use it.

## 3. Environments

| Environment  | Purpose                                         | Data       |
| ------------ | ----------------------------------------------- | ---------- |
| `local`      | Docker Compose, one command, seeded             | Synthetic  |
| `ci`         | Ephemeral per pull request, torn down after     | Synthetic  |
| `staging`    | Mirrors production topology at one replica each | Anonymised |
| `production` | Customer-operated, or Alicorn Cloud             | Real       |

`local` must come up with `docker compose up` and a seed script. If a new engineer cannot reach a
working inbox in fifteen minutes, that is a bug. The compose file `cloud/dev/compose/alicorn-local.yml`
provides the `local` environment: `pnpm alicorn:up && pnpm alicorn:seed` (from `cloud/`) seeds three
members (Developer, Reviewer, QA) in the `local` tenant — there is no org or workflow yet.

## 4. Infrastructure as code

- **Terraform** for cloud resources — network, managed Kubernetes, object storage, DNS, secrets store.
  One module per component, one root per environment. No console changes, ever.
- **Helm** for the application. One chart, one `values.yaml` per environment. The chart is the
  customer-facing deliverable for self-hosting, so it is a product surface — versioned, documented,
  and with a tested upgrade path between minor versions.
- **Secrets** via External Secrets Operator against the platform's own store (or SOPS-encrypted files
  for customers without one). No secrets in Git, no secrets in `values.yaml`.

## 5. CI/CD

```
pull request ──► lint · typecheck · unit · integration (ephemeral namespace)
                 │
merge to main ─► build images (multi-arch) ──► sign (cosign) ──► registry
                 │                                              │
                 └► deploy staging ──► smoke ──► manual gate ───┴► release tag
                                                                  │
                                                    Helm chart + desktop installers
```

- **Desktop builds** are a separate pipeline: macOS (Developer ID + notarisation), Windows (EV
  certificate — start procurement early, identity vetting takes weeks), Linux (glibc floor 2.31).
- **Images are signed** and an SBOM is published per release. Enterprise buyers ask; having it ready
  turns a two-week security review into a one-day one.
- **Database migrations run as a pre-upgrade Helm hook**, forward-only, each one tested against a
  restored production-shaped snapshot.

## 6. Observability

OpenTelemetry from the services, into a stack the customer can also self-host — no vendor lock, since
the whole product is self-hostable.

Status (2026-09-06): both services emit one JSON log line per request with `tenant_id` and
`request_id`, and expose Prometheus text at `GET /metrics` (loopback in compose; network-policy in
k8s). OpenTelemetry export is adopted when a customer needs Tempo/Grafana federation.
`amended_within_window` is scoped to the configured tenant in local auth mode; a cross-tenant
operator aggregate arrives with the identity plan (BYPASSRLS operator role).

| Signal  | Tool                   | What matters                                          |
| ------- | ---------------------- | ----------------------------------------------------- |
| Traces  | OTel → Tempo           | Gate evaluation latency; it sits on the hand-off path |
| Metrics | Prometheus → Grafana   | Below                                                 |
| Logs    | Loki                   | Structured JSON, `tenant_id` on every line            |
| Errors  | Sentry (self-hostable) | Desktop crashes especially                            |

### The metrics that actually matter

| Metric                             | Why                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `interruptions_per_completed_task` | **The product metric.** It is the claim the whole thing rests on.                                     |
| `gate_decisions{decision,reason}`  | Which rule is firing. A spike in `unverified` means checks are broken, not that agents got worse.     |
| `ledger_write_duplicates`          | Should be non-zero and absorbed. If it is zero, idempotency is probably not being exercised.          |
| `amended_within_window`            | The honesty check. Rising amendments with a flat accept rate means the corrections watcher has a gap. |
| `relay_connections`                | The only connection-bound resource.                                                                   |
| `postgres_replication_lag`         | Ledger reads are latency-sensitive at gate evaluation.                                                |

## 7. Capacity

Sizing from the shape of the load, not from a vendor calculator.

- **Ledger writes**: roughly 40 rows per developer per day. 100 developers ≈ **1.2M rows/year**;
  1,000 developers ≈ 12M. Monthly partitions on `created_at`. Index
  `(tenant_id, member_id, stage_key, created_at DESC)` for the track-record read.
- **Partitioning deferred**: the exactly-once unique key must stay a single-table constraint;
  introduce monthly partitions with a side idempotency table when rows exceed ~10M.
- **Gate evaluation** must stay under **150 ms p99** — it blocks a hand-off. It reads
  `member_stage_stats`, a single indexed row, never an aggregate over the ledger.
- **Relay**: connection-bound. Reuse the existing relay's regional cell topology rather than
  rebuilding it.
- **Object storage**: reports and exports only. Lifecycle rule to cold storage at 90 days.

A single Postgres with a replica carries this comfortably past a thousand seats. Do not introduce
Kafka, ClickHouse or a service mesh without a measurement that demands it.

## 8. Backup and recovery

|               | Target                                                  |
| ------------- | ------------------------------------------------------- |
| RPO           | 5 minutes (continuous WAL archiving)                    |
| RTO           | 1 hour                                                  |
| Backups       | Nightly base + WAL to object storage; 30-day retention  |
| Restore drill | Quarterly, into a scratch namespace, timed and recorded |

An untested backup is not a backup. The drill is a calendar item with an owner.

The ledger is append-only, which makes recovery unusually forgiving: replaying a gap is safe, and
`member_stage_stats` can be rebuilt from `step_outcomes` at any time.

## 9. Security posture

- TLS everywhere, terminated at ingress; mTLS between services when the mesh arrives, not before.
- Network policies: only `control-api` and `ledger-api` may reach Postgres; only `relay` may reach
  Redis.
- The services connect as a non-superuser application role (`alicorn_app` locally); superusers bypass
  row-level security, so a superuser connection string is a misconfiguration, not a convenience.
- Postgres row-level security is the tenant boundary, not application `WHERE` clauses.
- Container images: distroless base, non-root, read-only root filesystem, dropped capabilities.
- Dependency and image scanning in CI, blocking on critical.
- Annual penetration test once the first enterprise deal is in flight; the report shortens every
  subsequent security review.

## 10. Cost shape

Because execution is on the client, infrastructure cost is close to flat per tenant rather than
per seat.

| Deployment                          | Monthly, order of magnitude                                |
| ----------------------------------- | ---------------------------------------------------------- |
| Self-hosted, single VM, ≤25 seats   | Customer's own compute; ~1 vCPU, 4 GB                      |
| Self-hosted, Kubernetes, ~500 seats | 6–10 vCPU, 16 GB, ~50 GB storage                           |
| Alicorn Cloud, first 50 tenants     | Low four figures, dominated by managed Postgres and egress |

This is the structural advantage: competitors hosting agent execution pay per token and per container.
Alicorn pays for a control plane, and the marginal cost of a seat is nearly zero.
