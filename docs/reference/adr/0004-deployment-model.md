# ADR-0004: GitHub Actions + Tencent TCR Deployment Model

- **Status**: accepted
- **Date**: 2026-06-14
- **Deciders**: LuoMuLoyal

## Context

The original deployment used Gitee Go for CI/CD, which required a server-side git checkout. This
created coupling between the deployment system and the source control platform, and made rollbacks
harder. A simpler, more portable deployment model was needed.

Later, a blue-green dual-slot model was layered on top but retired because both slots talk to the
same Postgres (schema migrations visible to old and new code at once), the rollback path was broken
(`.env.previous` was snapshotted after writing the new image ref), and dual slots cost real resources
and complexity (double app memory, cron double-fire, SSE streams that cannot drain across slot
switch).

## Decision

Adopt GitHub Actions for both CI validation and CD deployment:

1. **CI (validation)**: lint, typecheck, build, unit tests, e2e tests — every push
2. **CD (deployment)**: build Docker image → push to Tencent Container Registry (TCR) → upload app
   files to server via SSH → remote deploy script

The server uses a single `/opt/lucent/` directory layout. Server does not keep a git checkout.

### Single-slot downtime deploy (2026-07-17 amendment)

Blue-green retired. Single app slot with a planned 15–45s downtime window per release:

1. Pre-deploy `pg_dump` snapshot (deploy aborts with zero downtime if the dump fails)
2. Snapshot `.env` to `.env.previous` **before** any modification
3. `docker compose stop app` → `prisma migrate deploy` runs inside the downtime window →
   start the new image
4. Health gate: the deploy fails automatically if the container does not become healthy
   (~150s), printing the new container's logs and restarting the previous image tag
5. Nginx reload after every app container recreate
6. Smoke test as the final business-level gate; failure also restores the previous image

Rollback = redeploy the previous image tag. The database schema never rolls back — destructive
migrations use expand-contract when the downtime window or rollback risk matters.

Production deploys are **manual-only** (`workflow_dispatch`, main branch). Staging keeps
auto-deploy on CI success.

### BullMQ worker topology

All BullMQ queue workers run inside the API process. `@Cron` tasks migrated to BullMQ Repeatable
Jobs (`upsertJobScheduler`, `tz: 'UTC'`) on 2026-07-27. `BullmqQueueFactory` creates `Worker`
instances in-process; Redis unavailable → graceful degradation to synchronous inline execution.
Prometheus metrics and alert rules are in place.

When queue throughput or LLM latency begins impacting HTTP response times, workers can be split
into a separate process/container using the same Docker image with a different entrypoint command.
This is intentionally deferred: current traffic levels do not cause measurable event loop
contention.

## Options Considered

| Option                                        | Pros                                                         | Cons                                                       |
| --------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| GitHub Actions + TCR + SSH deploy             | Industry standard, server keeps no git state, clean rollback | Requires GitHub Secrets for TCR/SSH credentials            |
| Gitee Go + server git checkout (old approach) | Already set up                                               | Platform coupling, server-side git state, harder rollbacks |
| Full Kubernetes / container orchestration     | Scalable, declarative                                        | Over-engineered for single-server deployment               |

## Consequences

- Server does not keep a git checkout — simplifies security and disk management
- Nginx reverse proxy handles TLS termination (port 80→443, proxy to app:3000)
- TLS certificates and Nginx config live in `/opt/lucent/`
- Monitoring stack stays under tracked repo path `monitoring/**`
- Rollback: deploy a previous image tag via the same CD workflow
- Accepted cost: 15–45s downtime per release → releases happen in off-peak hours, active SSE
  streams receive a terminal `server_shutdown` event before connections close
