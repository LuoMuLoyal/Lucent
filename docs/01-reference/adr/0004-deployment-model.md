# ADR-0004: GitHub Actions + Tencent TCR Deployment Model

- **Status**: accepted
- **Date**: 2026-06-14
- **Deciders**: LuoMuLoyal

## Context

The original deployment used Gitee Go for CI/CD, which required a server-side git checkout. This
created coupling between the deployment system and the source control platform, and made rollbacks
harder. A simpler, more portable deployment model was needed.

## Decision

Adopt GitHub Actions for both CI validation and CD deployment:

1. **CI (validation)**: lint, typecheck, build, unit tests, e2e tests — every push
2. **CD (deployment)**: build Docker image → push to Tencent Container Registry (TCR) → upload app
   files to server via SSH → remote deploy script

The server uses a split layout:

- `/opt/lucent/app`: app deploy files (overwritten by each deployment)
- `/opt/lucent/server`: server-local runtime files (.env, certs, logs, data) — never overwritten by
  deployment

## Options Considered

- GitHub Actions + TCR + SSH deploy
  - Pros: Industry standard, server keeps no git state, clean rollback
  - Cons: Requires GitHub Secrets for TCR/SSH credentials
- Gitee Go + server git checkout (old approach)
  - Pros: Already set up
  - Cons: Platform coupling, server-side git state, harder rollbacks
- Full Kubernetes / container orchestration
  - Pros: Scalable, declarative
  - Cons: Over-engineered for single-server deployment

## Consequences

- Server does not keep a git checkout — simplifies security and disk management
- Nginx reverse proxy handles TLS termination (port 80→443, proxy to app:3000)
- TLS certificates and Nginx config live in `/opt/lucent/server`, mounted as volumes
- Monitoring stack (Prometheus, Grafana) stays under tracked repo path `monitoring/**`, not as
  runtime-local files
- Rollback: deploy a previous image tag via the same CD workflow

## Update 2026-07-17: Blue-Green → Single-Slot Downtime Deploy

**Amendment**: the blue-green dual-slot switching later layered on top of this model is
retired. Everything else in this ADR (GitHub Actions + TCR + SSH deploy, no server-side git
state, rollback via previous image tag) still stands. The server layout was also simplified
earlier to a single `/opt/lucent/` directory (no `app/` vs `server/` split).

### Context

- Blue-green's core value (zero downtime, instant rollback) did not hold on a single host
  with a shared database: both slots talk to the same Postgres, so schema migrations are
  visible to old and new code at once and blue-green cannot isolate schema risk.
- The rollback path was broken: `deploy.ts` snapshotted `.env` to `.env.previous` **after**
  writing the new image ref into it, so a failed smoke test "rolled back" to the just-deployed
  broken version.
- Dual slots cost real resources and complexity: double app memory, cron jobs firing once per
  slot, SSE streams that cannot drain across a slot switch.

### Decision

Single app slot with a planned 15–45s downtime window per release:

1. Pre-deploy `pg_dump` snapshot (deploy aborts with zero downtime if the dump fails)
2. Snapshot `.env` to `.env.previous` **before** any modification
3. `docker compose stop app` → `prisma migrate deploy` runs inside the downtime window →
   start the new image
4. Health gate: the deploy fails automatically if the container does not become healthy
   (~150s), printing the new container's logs and restarting the previous image tag
5. Nginx reload after every app container recreate (the upstream IP is cached at config-load
   time; without a reload every request 502s)
6. Smoke test as the final business-level gate; failure also restores the previous image

Rollback = redeploy the previous image tag (`node deploy.ts --rollback`, or the
`lucent-production.yml` workflow with `action=rollback`). The database schema never rolls
back — destructive migrations should still use expand-contract when the downtime window or
rollback risk matters.

Production deploys are **manual-only** (`workflow_dispatch`, main branch): with a downtime
window per release, release timing must be human-controlled (off-peak hours). Staging keeps
auto-deploy on CI success.

### Consequences

- Rollback actually works (image tag is captured before any mutation)
- Destructive migrations are safer: old code is stopped before the schema advances
- Simpler runtime: one app container, no slot state, no cron double-fire
- Accepted cost: 15–45s downtime per release → releases happen in off-peak hours, and active
  SSE streams receive a terminal `server_shutdown` event before connections close
  (`SseConnectionRegistry`, 60s `stop_grace_period`)

## Update 2026-07-17: BullMQ Worker Topology (Architecture Review #7)

### Context

All 7 BullMQ queue workers + the `@Cron` lifecycle service run inside the API
process. Workers that perform CPU-intensive tasks (PDF generation, LLM calls)
compete with HTTP request handling for the same event loop.

### Current State (Accepted)

- `BullmqQueueFactory` creates `Worker` instances in-process; Redis unavailable
  → graceful degradation to synchronous inline execution.
- Single-slot deployment means no cron double-fire concern.
- Prometheus metrics (`bullmq_active_jobs`, `bullmq_waiting_jobs`) and alert
  rules (`BullMQJobFailures`, `BullMQWaitingBacklog`) are in place.

### Future Plan (Mid-term)

When queue throughput or LLM latency begins impacting HTTP response times:

1. Split workers into a separate process/container using the same Docker image
   with a different entrypoint command (e.g., `node dist/main.js --worker-only`).
2. `BullmqQueueFactory` gains a `--worker-only` flag that skips HTTP
   controllers but still registers workers.
3. `@Cron` lifecycle service moves to the worker process.
4. `compose.yml` adds a `worker` service alongside `app`, both pointing to the
   same image but with different commands.
5. No code changes needed in queue consumer services — BullMQ workers
   automatically distribute across connections to the same Redis instance.

This is intentionally deferred: current traffic levels do not cause measurable
event loop contention, and the single-slot deployment model keeps operational
complexity low.
