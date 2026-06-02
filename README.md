# Lucent

NestJS backend for Luminous. New backend work happens here; `Luminous/backend` is legacy production code.

## Stack

NestJS / PostgreSQL / Prisma / Redis / Passport JWT / OpenAI-compatible AI gateway

## Commands

```bash
pnpm install
pnpm dev:stack:up
pnpm db:migrate:all
pnpm start:dev
pnpm build
pnpm test
pnpm test:ci
pnpm test:e2e
pnpm test:e2e:ci
pnpm lint
pnpm export:openapi
pnpm import:medicine:all
```

Simple server deployment:

- keep a writable deployment directory on the server
- keep `.env.production` on the server
- use GitHub Actions workflow `.github/workflows/deploy-server.yml`
- workflow runs `lint` + `build` + unit/e2e tests, builds a Docker image, syncs deployment files over SSH, then recreates containers on the server
- workflow already opts JavaScript-based GitHub Actions into the Node 24 runtime, so the current pipeline does not rely on the deprecated Node 20 actions runtime
- the server no longer needs `git pull` access to GitHub during deployment
- PostgreSQL / Redis runtime images should be pre-seeded into the target registry once using the fixed tags `lucent-postgres:18-alpine` and `lucent-redis:8-alpine`
- the server keeps PostgreSQL / Redis data locally and uses `.deploy-image.env` to remember the deployed image tags
- default production compose is single-host: `app + postgres + redis` run together, and Lucent connects to `postgres` / `redis` service names inside Docker

Local database layout:

- development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- test / e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`

`pnpm dev:stack:up` starts both PostgreSQL services plus Redis. `pnpm db:migrate:all` applies Prisma migrations to both local databases.

Medicine import quick start:

- `pip install -r scripts/medicine/requirements.txt` if you want to import `FullDrugDetail.xlsx` directly.
- `pnpm import:medicine:all` runs the default development import order: DrugBank drugs -> links -> targets -> Chinese products.
- `scripts/dev/import-medicine-datasets.ps1 -Command <dataset> -SourcePath <file>` lets you smoke-test or override a single source file.
- For smoke tests you can call `powershell -ExecutionPolicy Bypass -File scripts/dev/import-medicine-datasets.ps1 -Limit 20 -WithHash`.

## Baseline

- API: `/api/v1`
- Health: `GET /api/v1/health`
- Response envelope: `{ code, message, data }`
- Language: `Accept-Language`, fallback `en`
- Auth e2e: register / login / refresh / me / logout

## Docs

Start with [docs/README.md](docs/README.md).

Key docs:

- [docs/public/api-contract.md](docs/public/api-contract.md)
- [docs/auth-api-mock.md](docs/auth-api-mock.md)
- [docs/environment.md](docs/environment.md)
- [docs/tencent-cloud-cicd.md](docs/tencent-cloud-cicd.md)
- [CHANGELOG.md](CHANGELOG.md)
