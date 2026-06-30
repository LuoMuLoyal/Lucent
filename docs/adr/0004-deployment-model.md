# ADR-0004: GitHub Actions + Tencent TCR Deployment Model

- **Status**: accepted
- **Date**: 2026-06-14
- **Deciders**: LuoMuLoyal

## Context

The original deployment used Gitee Go for CI/CD, which required a server-side git checkout. This created coupling between the deployment system and the source control platform, and made rollbacks harder. A simpler, more portable deployment model was needed.

## Decision

Adopt GitHub Actions for both CI validation and CD deployment:

1. **CI (validation)**: lint, typecheck, build, unit tests, e2e tests — every push
2. **CD (deployment)**: build Docker image → push to Tencent Container Registry (TCR) → upload app files to server via SSH → remote deploy script

The server uses a split layout:

- `/opt/lucent/app`: app deploy files (overwritten by each deployment)
- `/opt/lucent/server`: server-local runtime files (.env, certs, logs, data) — never overwritten by deployment

## Options Considered

| Option                                        | Pros                                                         | Cons                                                       |
| --------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| GitHub Actions + TCR + SSH deploy             | Industry standard, server keeps no git state, clean rollback | Requires GitHub Secrets for TCR/SSH credentials            |
| Gitee Go + server git checkout (old approach) | Already set up                                               | Platform coupling, server-side git state, harder rollbacks |
| Full Kubernetes / container orchestration     | Scalable, declarative                                        | Over-engineered for single-server deployment               |

## Consequences

- Server does not keep a git checkout — simplifies security and disk management
- Nginx reverse proxy handles TLS termination (port 80→443, proxy to app:3000)
- TLS certificates and Nginx config live in `/opt/lucent/server`, mounted as volumes
- Monitoring stack (Prometheus, Grafana) stays under tracked repo path `monitoring/**`, not as runtime-local files
- Rollback: deploy a previous image tag via the same CD workflow
