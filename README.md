# Lucent

[![Frontend: Luminous](https://img.shields.io/badge/frontend-LuoMuLoyal%2FLuminous-16a34a?logo=github)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the NestJS backend for Luminous. New backend work happens here; `Luminous/backend` is legacy reference code.

## Source Of Truth

- API contract: controller / DTO code plus generated [docs/openapi.json](docs/openapi.json).
- Database model: [prisma/schema.prisma](prisma/schema.prisma).
- Runtime configuration: [docs/environment.md](docs/environment.md).
- Medicine data imports: [docs/public/data-sources.md](docs/public/data-sources.md).
- Product direction: [../Luminous/docs/Product_Vision.md](../Luminous/docs/Product_Vision.md).

Hand-written endpoint mocks and commit-style changelogs are intentionally not maintained. Regenerate OpenAPI when API code changes:

```bash
pnpm export:openapi
```

## Stack

- NestJS 11
- Prisma 7 / PostgreSQL
- Redis / BullMQ
- Passport JWT
- WeChat Web / Mobile OAuth login
- OpenAPI-generated client/docs
- LangChain-based AI integration foundation

## Local Development

```bash
pnpm install
pnpm dev:stack:up
pnpm db:migrate:all
pnpm start:dev
```

For the mobile full-stack E2E lane, run Lucent against the test database so
the test-only support route is available:

```bash
cp .env.test.example .env.test
pnpm start:test:dev
```

Or use the local helper that starts the test runtime in a hidden PowerShell
window and waits for `GET /api/v1/health`:

```bash
powershell -ExecutionPolicy Bypass -File scripts/dev/start-test-runtime.ps1
```

That runtime enables `POST /api/v1/testing/fullstack-e2e/record-lane/prepare`,
which repairs a dedicated password-login test user and clears that user's daily
records for one target date before the Flutter lane starts.

The embedded AdminJS panel is available at `/admin`. In local development the
template credentials are `admin@lucent.local` / `admin12345`; override
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_COOKIE_SECRET` in your local env
file before exposing it.

JWT access and refresh secrets also come from the env file now; the dev/test
templates already include local values.

Daily-record image uploads are signed by Lucent for Tencent COS. Configure
`TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_BUCKET`, and
`TENCENT_COS_REGION` to enable `POST /api/v1/user/daily-records/attachments/images/presign-upload`.

AI runtime configuration is role-based and OpenAI-compatible only. Configure
`AI_PROVIDER=openai-compatible`, then give each role its own
`BASE_URL` / `API_KEY` / `MODEL`, including analysis, vision, language,
chat, chat compression, and embedding. See [docs/environment.md](docs/environment.md).
`AI_LANGUAGE_MODEL` now powers `POST /api/v1/user/daily-records/candidate-records/generate`,
which converts one natural-language note into user-confirmed candidate daily records
without writing directly into the final daily-record table.
Today and Report AI summaries now also expose SSE variants:

- `POST /api/v1/user/today-analysis/generate/stream`
- `POST /api/v1/user/reports/summary/generate/stream`

They stream safe partial `summary` text first, then finish with the final structured payload.

If the OpenAI-compatible base URL targets DeepSeek, Lucent now disables
DeepSeek `thinking` mode automatically for these streaming tool-use flows so
`tool_choice` requests can complete normally.

Production compose now also includes a same-host monitoring stack:

- Prometheus on `127.0.0.1:9090`
- Grafana on `127.0.0.1:3001`
- a synthetic exporter on `synthetic-monitor:9101` inside the compose network

Grafana provisions the Lucent Prometheus datasource and a default
`Lucent Overview` dashboard automatically at startup.

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
- `GET /metrics`
  - Prometheus text exposition endpoint
  - intentionally outside `/api` and outside the normal API envelope

Recommended use:

- container liveness: `/api/v1/health/live`
- container readiness / deployment gate: `/api/v1/health/ready`
- manual diagnosis: `/api/v1/health/deep`
- monitoring scrape: `/metrics`

Synthetic monitoring:

- `auth_login`
  - real `POST /api/v1/auth/login` with configured synthetic user credentials
- `account_profile`
  - real `GET /api/v1/account` with the access token returned by `auth_login`

These checks are exported as Prometheus metrics by the `synthetic-monitor`
sidecar and show up in the default Grafana dashboard.

## Verification

```bash
pnpm typecheck
pnpm lint:check
pnpm build
pnpm test:ci
pnpm test:e2e:ci
pnpm export:openapi
```

Use narrower commands while iterating, then run the relevant broader checks before finishing a backend change. `pnpm build` does not type-check `**/*spec.ts` or `test/`; use `pnpm typecheck` when you need full TypeScript coverage for unit/e2e test files.

## Source Layout

- `src/modules/` contains business feature modules: auth, account, user, health context, daily records, dose logs, medicines.
- Top-level `src/` keeps app bootstrap and infrastructure/runtime support: `common`, `config`, `generated`, `i18n`, `mail`, `prisma`.
- `scripts/` contains local dev, OpenAPI export, deployment, and medicine import helpers.

## Deployment Model

- GitHub Actions now owns validation only:
  - `lint`
  - `typecheck`
  - `build`
  - unit tests
  - e2e tests
- Deployment is expected to run on the server host after the server can access the public internet:
  - `git pull --ff-only`
  - `docker compose pull` for public base images
  - `docker compose build app`
  - `sh scripts/deploy/deploy-server.sh`
- The intended production automation direction is:
  - GitHub repository stays the source repo
  - Gitee mirrors the repo
  - Gitee Go or another server-side runner executes the same server-local deployment script

## Docs

Start with [docs/README.md](docs/README.md).

Active docs:

- [docs/environment.md](docs/environment.md)
- [docs/tencent-cloud-cicd.md](docs/tencent-cloud-cicd.md)
- [docs/deployment-checklist.md](docs/deployment-checklist.md)
- [docs/openapi.json](docs/openapi.json)
- [docs/public/data-sources.md](docs/public/data-sources.md)
- [docs/public/reminder-contract.md](docs/public/reminder-contract.md)
- [docs/public/environment-contract.md](docs/public/environment-contract.md)
