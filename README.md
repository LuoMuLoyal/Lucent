# Lucent

[![CI](https://github.com/LuoMuLoyal/Lucent/actions/workflows/lucent-ci.yml/badge.svg)](https://github.com/LuoMuLoyal/Lucent/actions/workflows/lucent-ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend: Luminous](https://img.shields.io/badge/frontend-LuoMuLoyal%2FLuminous-16a34a?logo=github)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the NestJS backend for [Luminous](https://github.com/LuoMuLoyal/Luminous), a personal health
management assistant. It provides authentication, health records, AI-powered analysis, medicine
knowledge retrieval, and data export.

**Current version:** `0.1.0-dev` — see the [Roadmap](ROADMAP.md) for the path to stable release.

## Key Features

- **Auth** — credential login + WeChat / Apple / QQ OAuth, JWT sessions, in-app Security PIN
- **Health Records** — daily records (water, meal, vital, mood, symptom, activity, note, sleep),
  dose logs, medicine reminders, allergies / conditions / current medicines
- **AI Pipeline** — Today analysis, Report summaries, NL record candidates, meal-analysis vision,
  agent-based assistant with source-split RAG, SSE streaming
- **Medicine Knowledge** — CN products + leaflet chunks, DrugBank drugs, medical QA corpus,
  three independent vector retrieval sources
- **Data Export** — BullMQ async PDF export with inline fallback
- **Admin Panel** — embedded AdminJS at `/admin` with auto-discovered Prisma resources

## Quick Start

```bash
corepack enable
corepack prepare pnpm@12.0.0 --activate
pnpm install
pnpm dev:stack        # start local PostgreSQL + Redis + SeaweedFS
pnpm db:migrate       # apply migrations
pnpm start:dev        # start dev server
```

Prerequisites: Node.js `24.x`, pnpm `11.x` or `12.x`, Docker (for `dev:stack`).

## Documentation

| Resource              | Link                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| Architecture          | [docs/explanation/architecture.md](docs/explanation/architecture.md)               |
| Environment variables | [docs/reference/environment-variables.md](docs/reference/environment-variables.md) |
| Deployment            | [docs/reference/deployment.md](docs/reference/deployment.md)                       |
| API contract          | `docs/reference/generated/openapi.json` (generated, tracked)                       |
| ADRs                  | [docs/reference/adr/](docs/reference/adr/)                                         |
| Docs index            | [docs/README.md](docs/README.md)                                                   |
| TODO                  | [docs/TODO.md](docs/TODO.md)                                                       |
| Contributing          | [CONTRIBUTING.md](CONTRIBUTING.md)                                                 |
| Security policy       | [SECURITY.md](SECURITY.md)                                                         |

## Source Of Truth

- API contract: controller / DTO code plus a local generated
  `docs/reference/generated/openapi.json` export.
- Database model: [prisma/schema.prisma](prisma/schema.prisma).
- Runtime configuration: [docs/reference/environment-variables.md](docs/reference/environment-variables.md).
- Medicine data imports: [src/modules/medicines/README.md](src/modules/medicines/README.md).
- Product direction: [../Luminous/docs/product/Product_Vision.md](../Luminous/docs/product/Product_Vision.md).

Hand-written endpoint mocks are intentionally not maintained. Regenerate OpenAPI when API code changes:

```bash
pnpm export:openapi
```

Before merging API contract changes, export a fresh local `docs/reference/generated/openapi.json` and regenerate the Flutter client from `../Luminous`:

```bash
cd ../Luminous
dart run tool/bootstrap_generated_sources.dart
dart run tool/verify_lucent_openapi_sync.dart
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
- Prisma 7 / PostgreSQL
- Redis / BullMQ
- Passport JWT
- Winston / nest-winston structured logging
- prom-client / Prometheus / Grafana metrics (ADR-0006)
- WeChat Web / Mobile OAuth login
- OpenAPI-generated client/docs
- LangChain / LangGraph-based AI integration foundation

## Local Development

```bash
corepack enable
corepack prepare pnpm@12.0.0 --activate
pnpm install
pnpm dev:stack
pnpm db:migrate
pnpm start:dev
```

Local toolchain baseline:

- Node.js `24.x`
- pnpm `11.x` / `12.x` compatible (`12.0.0` is the pinned CI / recommended Corepack baseline; `11.9.0` also accepted)

Local infrastructure note:

- `pnpm dev:stack` now starts both local PostgreSQL services from `pgvector/pgvector:pg18`.
- This is required for Lucent assistant RAG indexing because local scripts and `PGVectorStore` expect the `vector` extension to exist.
- GitHub Actions CI now uses the same `pgvector/pgvector:pg18` PostgreSQL family for its test database service so vector-dependent backend paths are not validated against a weaker database baseline than local development.
- `pnpm dev:stack` also starts SeaweedFS (`chrislusf/seaweedfs:4.41`) as the dev-only S3-compatible
  object storage (S3 API on port `8333`, Filer on `8888`). Set `STORAGE_PROVIDER=s3` and configure
  `STORAGE_S3_*` in `.env.development` to use local object storage instead of Tencent COS.
  See ADR-0014 for details.

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

The embedded AdminJS panel is available at `/admin`. Resources are auto-discovered
from `prisma/schema.prisma`, and all registered models support full CRUD by
default. Customizations for core models live in `src/admin/setup.ts`.
In local development the template credentials are `admin@lucent.local` /
`admin12345`; override `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and
`ADMIN_COOKIE_SECRET` in your local env file before exposing it.

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

Production compose also includes an Nginx reverse proxy:

- `80` redirects to `443`
- `443` proxies to `app:3000`
- TLS certificates and Nginx config are mounted from the server-local runtime directory

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

Use narrower commands while iterating, then run `pnpm check` before finishing a backend change. `pnpm build` does not type-check `**/*spec.ts` or `test/`; use `pnpm typecheck` when you need full TypeScript coverage for unit/e2e test files. Repo helper scripts under `scripts/` and deploy CLIs under `deploy/` use their own lighter TS projects; validate them with `pnpm typecheck:tools`.

For production smoke testing after CD or manual server updates:

```bash
LUCENT_PUBLIC_BASE_URL=https://your-host-or-domain pnpm deploy:smoke
```

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
  - `scripts/import/food/` for food composition import helpers and Python parsers
- `deploy/` contains production deployment assets: compose file, remote deploy CLI, and Nginx config.
- `test/e2e/` groups e2e specs by feature instead of keeping every suite flat at `test/`.
- AI-oriented modules now use a clearer inner split when the capability is larger than plain DTO/controller code:
  - `prompts/`
  - `schemas/`
  - `services/`
  - plus module-specific folders such as `agent/` or `tools/` when needed

## Deployment Model

- GitHub Actions owns validation:
  - `lint`
  - `typecheck`
  - `build`
  - unit tests
  - e2e tests
- GitHub Actions also owns CD:
  - build the Lucent Docker image
  - push the image to Tencent TCR
  - upload the app deploy directory to the server over SSH
  - run one server-side deploy script remotely
- The server does not keep a git checkout.
- The server keeps a single directory at `/opt/lucent/` containing compose assets,
  `.env`, certs, data volumes, and logs — see
  [docs/reference/deployment.md](docs/reference/deployment.md) for the full layout
- The app itself is always deployed from the pushed image, not built on the server

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
