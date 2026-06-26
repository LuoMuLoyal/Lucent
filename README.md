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
- LangChain / LangGraph-based AI integration foundation

## Local Development

```bash
pnpm install
pnpm dev:stack
pnpm db:migrate
pnpm start:dev
```

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
default. Customizations for core models live in `src/admin/adminjs.setup.ts`.
In local development the template credentials are `admin@lucent.local` /
`admin12345`; override `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and
`ADMIN_COOKIE_SECRET` in your local env file before exposing it.

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

For deployed-MVP smoke after CD or manual server updates:

```bash
LUCENT_APP_DIR=/opt/lucent/app LUCENT_SERVER_DIR=/opt/lucent/server LUCENT_PUBLIC_BASE_URL=https://your-host-or-domain pnpm deploy:smoke
```

## Source Layout

- `src/modules/` contains business feature modules: auth, account, user, health context, daily records, dose logs, medicines.
- Top-level `src/` keeps app bootstrap and infrastructure/runtime support: `common`, `config`, `generated`, `i18n`, `mail`, `prisma`.
- `scripts/` contains a small set of local helpers grouped by purpose:
  - `scripts/dev/` for local runtime helpers
  - `scripts/contract/` for contract export helpers
  - `scripts/import/medicine/` for medicine data import helpers and Python parsers
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
- The server keeps:
  - app files under `/opt/lucent/app`
  - local runtime files and data under `/opt/lucent/server`
- The app itself is always deployed from the pushed image, not built on the server.

## Docs

Start with [docs/README.md](docs/README.md).

Active docs:

- [docs/environment.md](docs/environment.md)
- [docs/deployment.md](docs/deployment.md)
- [docs/openapi.json](docs/openapi.json)
- [docs/public/data-sources.md](docs/public/data-sources.md)
- [docs/public/reminder-contract.md](docs/public/reminder-contract.md)
- [docs/public/environment-contract.md](docs/public/environment-contract.md)
