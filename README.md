# Lucent

[![CI](https://github.com/LuoMuLoyal/Lucent/actions/workflows/ci.yml/badge.svg)](https://github.com/LuoMuLoyal/Lucent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend: Luminous](https://img.shields.io/badge/frontend-LuoMuLoyal%2FLuminous-16a34a?logo=github)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the NestJS backend for [Luminous](https://github.com/LuoMuLoyal/Luminous), a personal health
management assistant. It provides authentication, health records, AI-powered analysis, medicine
knowledge retrieval, ontology-grounded drug reasoning, and data export.

**Current version:** `0.1.0-dev` — the evolution plan lives in [ROADMAP.md](ROADMAP.md), and the
remaining-work ledger in [docs/TODO.md](docs/TODO.md) plus [plans/](plans/).

## Key Features

- **Auth** — credential login + WeChat / Apple / QQ / Google OAuth, JWT sessions,
  device-session management, password re-authentication for sensitive operations
- **Health Records** — daily records (water, meal, vital, mood, symptom, activity, note, sleep),
  dose logs, medicine reminders, health events, allergies / conditions / current medicines
- **AI Pipeline** — Today analysis, Report summaries, NL record candidates, meal-analysis vision,
  agent-based assistant with source-split retrieval, SSE streaming, proposal-based writes
  confirmed by the user
- **Proactive Suggestions** — rule engine plus arbitration / suppression / lifecycle over daily
  records, dose logs, health events and profile, materialized at write time
- **Medicine Knowledge** — CN products + leaflet chunks, DrugBank drugs, medical QA corpus.
  Three retrieval sources are kept strictly separate: Chinese prose via LightRAG,
  DrugBank passages via Lucent's own pgvector tables, CN product lookups via SQL
- **Ontology-Augmented Generation (English side)** — DrugBank structured facts are mapped
  deterministically into a Neo4j graph (no LLM extraction); `reason_over_ontology` performs
  typed multi-hop queries where each conclusion carries a PROV-O citation back to its source row
- **Data Export** — BullMQ async PDF export with inline fallback
- **Admin Console** — React SPA at `/admin` (independent `admin/` project), backed by
  the permission-guarded `/api/v1/admin/*` endpoints

## Quick Start

```bash
npm install --global pnpm@12.0.0
pnpm install
pnpm dev:stack        # start local PostgreSQL + Redis + SeaweedFS
pnpm db:migrate       # apply migrations
pnpm start:dev        # start dev server
```

Prerequisites: Node.js `26.x`, pnpm `11.x` or `12.x`, Docker (for `dev:stack`).

## Documentation

| Resource              | Link                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| Architecture          | [docs/explanation/architecture.md](docs/explanation/architecture.md)               |
| Environment variables | [docs/reference/environment-variables.md](docs/reference/environment-variables.md) |
| Deployment            | [docs/reference/deployment.md](docs/reference/deployment.md)                       |
| API contract          | `docs/reference/generated/openapi.json` (generated, tracked)                       |
| ADRs                  | [docs/reference/adr/](docs/reference/adr/)                                         |
| Docs index            | [docs/README.md](docs/README.md)                                                   |
| Changelog             | [CHANGELOG.md](CHANGELOG.md)                                                       |
| Roadmap               | [ROADMAP.md](ROADMAP.md)                                                           |
| TODO                  | [docs/TODO.md](docs/TODO.md)                                                       |
| Contributing          | [CONTRIBUTING.md](CONTRIBUTING.md)                                                 |
| Security policy       | [SECURITY.md](SECURITY.md)                                                         |
| Code of conduct       | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                                           |
| Licensing             | [LICENSE](LICENSE) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)              |

## Source Of Truth

- API contract: controller / DTO code plus a local generated
  `docs/reference/generated/openapi.json` export.
- Database model: [prisma/schema.prisma](prisma/schema.prisma).
- Runtime configuration: [docs/reference/environment-variables.md](docs/reference/environment-variables.md).
- Medicine data imports: [src/modules/medicines/README.md](src/modules/medicines/README.md).
- Product direction: [../Luminous/docs/product/product-vision.md](../Luminous/docs/product/product-vision.md).

Hand-written endpoint mocks are intentionally not maintained. Regenerate OpenAPI when API code changes:

```bash
pnpm export:openapi
```

Before merging API contract changes, export a fresh local `docs/reference/generated/openapi.json` and regenerate the Flutter client from `../Luminous`:

```bash
cd ../Luminous
dart run scripts/contract/bootstrap.dart
dart run scripts/contract/verify_openapi.dart
```

Generated artifact policy in this repo:

- `generated/prisma/` is intentionally local-only and stays ignored. Regenerate it from
  `prisma/schema.prisma` plus migrations through the normal Prisma flow instead of committing it.
- `docs/reference/generated/openapi.json` is tracked in git (marked as `linguist-generated`). Regenerate it with `pnpm export:openapi` after API changes, then commit.
  before regenerating the Luminous client or validating cross-repo contract sync.

Lucent CI re-exports the spec and fails when the committed
`docs/reference/generated/openapi.json` does not match current code.

## Stack

- NestJS 12 (ESM / SWC builder), zod 4 + Standard Schema validation
- Prisma 7 / PostgreSQL 18 (self-built image: `pgvector/pgvector:pg18` + zhparser; `pg_trgm` ships
  with PostgreSQL contrib)
- Redis 8 / BullMQ
- Neo4j 5.26 Community as the English-side OAG graph backend, with the Semantica sidecar
  for ontology-grounded reasoning (decision: ADR-0022; bundled as a separate container, not linked
  into this codebase — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md))
- Passport JWT
- Winston / nest-winston structured logging
- prom-client / VictoriaMetrics / Grafana metrics (ADR-0006, ADR-0016)
- Grafana unified alerting on the monitoring host (rules, contact points and notification policies
  are versioned under `monitoring/grafana/provisioning/alerting/`)
- WeChat Web / Mobile OAuth login
- OpenAPI-generated client/docs
- LangChain / LangGraph-based AI integration foundation
- LightRAG sidecar for Chinese prose retrieval (ADR-0021)

## Local Development

```bash
npm install --global pnpm@12.0.0
pnpm install
pnpm dev:stack
pnpm db:migrate
pnpm start:dev
```

Local toolchain baseline:

- Node.js `26.x`
- pnpm `11.x` / `12.x` compatible (`12.0.0` is the pinned CI baseline; `11.9.0` also accepted)

Local infrastructure note:

- `pnpm dev:stack` starts both local PostgreSQL services from the self-built
  `${LUCENT_DB_IMAGE:-lucent-db:18}` image (`docker/postgres/`), which layers
  **zhparser** on top of `pgvector/pgvector:pg18`. Build it once with
  `docker build -t lucent-db:18 docker/postgres`.
- pgvector is required for Lucent assistant RAG indexing because local scripts and `PGVectorStore`
  expect the `vector` extension to exist.
- The English-side OAG graph lives in **Neo4j**, entirely outside Postgres and the Prisma migration
  domain; LightRAG keeps using plain SQL tables. See ADR-0022.
- GitHub Actions CI uses the same `pgvector/pgvector:pg18` PostgreSQL family for its test database
  service so vector-dependent backend paths are not validated against a weaker database baseline
  than local development.
- `pnpm dev:stack` also starts SeaweedFS (`chrislusf/seaweedfs:4.41`) as the dev-only S3-compatible
  object storage (S3 API on port `8333`, Filer on `8888`). Set `STORAGE_PROVIDER=s3` and configure
  `STORAGE_S3_*` in `.env.development` to use local object storage instead of Tencent COS.
  See ADR-0014.
- The LightRAG and Semantica sidecars are declared in `compose.dev.yaml` behind profiles, so a plain
  `pnpm dev:stack` does not start them. Without them the corresponding assistant tools report
  `retrieval_unavailable` rather than silently returning empty evidence.

For the mobile full-stack E2E lane, run Lucent against the test database so
the test-only support route is available:

```bash
cp .env.test.example .env.test
pnpm start:test:dev
```

Or use the local helper that starts the test runtime in the background and
waits for `GET /api/v1/health`:

```bash
pnpm test:runtime:start
```

That helper first runs `prisma migrate deploy` against the test database, then
starts the runtime. The runtime enables `POST /api/v1/testing/fullstack-e2e/record-lane/prepare`,
which repairs a dedicated password-login test user, resets that user's AI
summary toggle to enabled, and clears that user's daily records for one target
date before the Flutter lane starts.

The administration console is a React SPA served by the backend at `/admin`
(same origin as the API, so no CORS exception is needed). Its build lives in the
independent `admin/` pnpm project: run `pnpm install && pnpm build` there, or let
the Docker image build it. `ADMIN_CONSOLE_ENABLED=false` hands static hosting to
an external web server, and `ADMIN_CONSOLE_DIR` points at a build outside the
repo. Console sign-in uses a real Lucent account that holds an `AdminUser` grant
(`pnpm admin:seed <email> <role>`); every administration endpoint re-checks the
role and permission server-side.

The auto-generated AdminJS panel was retired together with its `ADMIN_*`
credentials: there is no second administration identity, and the API answers only
to JWT-authenticated `AdminUser` grants.

JWT access and refresh secrets also come from the env file now; the dev/test
templates already include local values.

Lucent runtime logging now uses `nest-winston` with Winston transports.
Request logs, Nest app logs, and global exception logs share the same structured
logger baseline, and every request gets a propagated `X-Request-Id` plus a
matching request context entry for downstream logs.

Daily-record image uploads are signed by Lucent for Tencent COS. Configure
`TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_BUCKET`, and
`TENCENT_COS_REGION` to enable `POST /api/v1/user/daily-records/attachments/images/presign-upload`.

AI runtime configuration is role-based and OpenAI-compatible only. Configure
`AI_PROVIDER=openai-compatible`, then give each role its own
`BASE_URL` / `API_KEY` / `MODEL`, including analysis, vision, language,
chat, chat compression, and embedding. See [docs/reference/environment-variables.md](docs/reference/environment-variables.md).
`AI_LANGUAGE_MODEL` now powers `POST /api/v1/user/daily-records/candidate-records/generate`,
which converts one natural-language note into user-confirmed candidate daily records
without writing directly into the final daily-record table.
Today and Report AI summaries now also expose SSE variants:

- `POST /api/v1/user/today-analysis/generate/stream`
- `POST /api/v1/user/reports/summary/generate/stream`

They stream safe partial `summary` text first, then finish with the final structured payload.

If the current runtime does not provide an `analysis` model config, these Today
and Report AI summary endpoints now fall back to deterministic copy instead of
failing, so the local full-stack E2E lane remains repeatable without live model
credentials.

If the OpenAI-compatible base URL targets DeepSeek, Lucent now disables
DeepSeek `thinking` mode automatically for these streaming tool-use flows so
`tool_choice` requests can complete normally.

Deployment runs a repo-owned compose on each host, managed with plain
`docker compose`: `compose.yaml` is deployed twice with an explicit service subset
(app + data + retrieval on one host, graph backend on another) and
`compose.monitoring.yaml` runs the observability stack on a third. Access is
controlled by the cloud security group's source-IP allowlist. See the deployment
docs below.

Local database layout:

- development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- test / e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`
- Redis: `redis://127.0.0.1:6379`

## Runtime Probes

- `GET /api/v1/health`
  - compatibility alias for existing readiness checks
  - returns `200` when critical dependencies are ready, `503` otherwise
- `GET /api/v1/health/live`
  - cheap liveness probe for process survival only
- `GET /api/v1/health/ready`
  - readiness probe for PostgreSQL plus Redis when `REDIS_URL` is configured
- `GET /api/v1/health/deep`
  - detailed dependency probe with timings and error text
    Recommended use:

- container liveness: `/api/v1/health/live`
- container readiness / deployment gate: `/api/v1/health/ready`
- manual diagnosis: `/api/v1/health/deep`

## Verification

```bash
pnpm check
```

Use narrower commands while iterating, then run `pnpm check` before finishing a backend change. `pnpm build` does not type-check `**/*spec.ts` or `test/`; use `pnpm typecheck` when you need full TypeScript coverage for unit/e2e test files. Repo helper scripts under `scripts/` use their own lighter TS project; validate them with `pnpm typecheck:tools`.

Deployment is three hosts running a repo compose each, with GitHub Actions CD only
building & pushing the Docker image. See
[docs/reference/deployment.md](docs/reference/deployment.md) for the model and
[docs/howto/deploy.md](docs/howto/deploy.md) for the operational steps.

## Source Layout

- `src/modules/` contains business feature modules: auth, account, user, health context, daily records, dose logs, medicines.
- Top-level `src/` keeps app bootstrap and infrastructure/runtime support: `common`, `config`, `i18n`, `mail`, `prisma`.
- `src/common/` now separates shared code by role instead of a catch-all `utils/` bucket:
  - `helpers/` for pure helper functions and stateless utilities
  - `services/` for shared injectable services
  - `logger/` for the shared Winston/Nest logging module plus request context helpers
- `scripts/` contains a small set of local helpers grouped by purpose:
  - `scripts/dev/` for local runtime helpers
  - `scripts/contract/` for contract export helpers
  - `scripts/import/medicine/` for medicine data import helpers and Python parsers
- `compose.yaml` (the app + data + retrieval services, and the graph backend pair),
  `compose.monitoring.yaml` (the metrics/logs/traces stack) and `compose.dev.yaml`
  (local dev) at the repo root hold the stack definitions; `deploy/` holds sidecar
  configuration (LightRAG env template and prompt profiles); `monitoring/` contains
  VictoriaMetrics scrape config and Grafana provisioning/dashboards.
- `entrypoint.sh` at the repo root is the container startup entrypoint (copied into the
  image): it runs `prisma migrate deploy` before starting the app, so migrations are
  applied automatically on container start and a failed migration aborts startup.
- `test/e2e/` groups e2e specs by feature instead of keeping every suite flat at `test/`.
- AI-oriented modules now use a clearer inner split when the capability is larger than plain DTO/controller code:
  - `prompts/`
  - `schemas/`
  - `services/`
  - plus module-specific folders such as `agent/` or `tools/` when needed

## Deployment Model

- GitHub Actions owns validation (`ci.yml`): lint, typecheck, build, unit tests, e2e tests.
  `docker.yml` builds both architectures and Trivy-scans them without pushing.
- **Image release** (`release.yml`, manual `workflow_dispatch` from `main`): builds `lucent`
  and `lucent-db` **natively per architecture** (amd64 + arm64) and merges them into
  multi-arch manifests in the publisher's own registry (`REGISTRY_IMAGE` GitHub secret, e.g.
  `docker.io/<your-user>/lucent`), tagged `sha-<short-sha>` plus `latest`. No QEMU, no
  server-side build, no SSH deploy scripts, no hardcoded image address in the repo.
  See [.github/workflows/README.md](.github/workflows/README.md) for the release model.
- **Runtime** — three hosts, one compose per host, each managed with plain
  `docker compose up -d`; all ports are published and access is controlled by the cloud
  security group's source-IP allowlist. `compose.yaml` is deployed twice with an explicit
  service subset (app + postgres/redis/lightrag/node-exporter on one host; neo4j + semantica
  on another), and `compose.monitoring.yaml` runs the metrics/logs/traces stack on a third.
  Cross-host traffic goes over the public internet (the clouds' VPCs are not peered), so
  inter-host addresses must be public. Releases: update the `LUCENT_IMAGE` reference in the
  host's `.env`, then pull and `up -d --force-recreate <service>` (the container entrypoint
  runs `prisma migrate deploy` on start); rollback is the same sequence with the previous
  `sha-` tag. Because the tag points at a multi-arch manifest, the architecture is chosen by
  Docker — switching hosts never changes the tag. There is no reverse proxy, no domain and no
  TLS today — the API is served over plain HTTP.
- Alerting is configured (Grafana unified alerting on the monitoring host; alert rules, contact
  points and notification policies are versioned YAML under `monitoring/grafana/provisioning/alerting/`).
  Automated database backups are **not** configured yet.
- See [docs/reference/deployment.md](docs/reference/deployment.md) for the full model and
  [docs/howto/deploy.md](docs/howto/deploy.md) for the operational steps.

## Docs

Start with [docs/README.md](docs/README.md) — the唯一文档索引(布局、六向裁决、模块 README 索引)。
活跃规划见 [plans/](plans/),延后项台账见 [docs/TODO.md](docs/TODO.md)。

- [docs/explanation/architecture.md](docs/explanation/architecture.md) — 跨模块心智模型
- [docs/reference/environment-variables.md](docs/reference/environment-variables.md) — 环境变量与本地基线
- [docs/reference/deployment.md](docs/reference/deployment.md) — 部署模型参考
- [docs/reference/glossary.md](docs/reference/glossary.md) — 术语表
- [docs/reference/assistant-safety.md](docs/reference/assistant-safety.md) — AI 医疗安全红线
- [docs/reference/adr/](docs/reference/adr/) — Architecture Decision Records
- `docs/reference/generated/` — 生成物(openapi.json、compodoc,禁手改)
- [docs/howto/](docs/howto/) — 操作指南
- [docs/logs/migration-log/](docs/logs/migration-log/) — 按日变更账本
- 模块边界与契约:`src/modules/<m>/README.md`(与代码同址)
