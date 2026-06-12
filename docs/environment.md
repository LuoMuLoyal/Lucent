# Lucent Environment

Last updated: 2026-06-12

This file records Lucent runtime configuration, local stacks, scripts, and required variables. Tencent CVM/TCR deployment steps live in `tencent-cloud-cicd.md`.

## Env Files

Runtime files are local only and must not be committed:

```text
.env.development
.env.production
.env.test
.env.development.local
.env.production.local
```

Tracked templates:

```text
.env.development.example
.env.production.example
```

Loading order, highest priority first:

```text
.env.<NODE_ENV>.local
.env.<NODE_ENV>
.env
```

Prisma CLI uses the same resolution order through `prisma.config.ts`.

## Local Baseline

- Development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- Test/e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`
- Redis: `redis://127.0.0.1:6379`
- Global prefix: `/api`
- URI versioning default: `1`
- Health check: `GET /api/v1/health`
- Admin panel: `GET /admin`

Start local infrastructure:

```bash
pnpm dev:stack:up
pnpm db:migrate:all
pnpm start:dev
```

## Scripts

| Command                         | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `pnpm start` / `pnpm start:dev` | Development runtime with `NODE_ENV=development`               |
| `pnpm start:test:dev`           | Test runtime with `NODE_ENV=test` for full-stack lane support |
| `pnpm start:prod`               | Built production runtime with `NODE_ENV=production`           |
| `pnpm test`                     | Unit tests with `NODE_ENV=test`                               |
| `pnpm test:ci`                  | Unit tests in CI with `--runInBand`                           |
| `pnpm test:e2e`                 | E2E tests with Prisma 7 VM-module compatibility               |
| `pnpm test:e2e:ci`              | E2E tests in CI with `--runInBand`                            |
| `pnpm export:openapi`           | Build then export `docs/openapi.json` from `dist`             |
| `pnpm import:medicine:all`      | Default medicine knowledge import sequence                    |

Run Prisma commands with explicit `NODE_ENV` when not targeting development, for example:

```bash
NODE_ENV=test pnpm exec prisma migrate deploy
```

## Required Production Variables

Production startup requires:

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_COOKIE_SECRET
CORS_ORIGIN
```

`CORS_ORIGIN=*` is accepted for local development but rejected in production.

JWT and admin secrets are required in every runtime now; keep them in the env
files, not in code defaults. The checked-in dev/test templates already provide
local values.

## Optional Integrations

WeChat OAuth:

```text
WECHAT_WEB_APP_ID
WECHAT_WEB_APP_SECRET
WECHAT_WEB_REDIRECT_URI
WECHAT_MOBILE_APP_ID
WECHAT_MOBILE_APP_SECRET
```

Daily-record image uploads through Tencent COS:

```text
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_BUCKET
TENCENT_COS_REGION
TENCENT_COS_PUBLIC_BASE_URL
TENCENT_COS_UPLOAD_EXPIRES_SECONDS
TENCENT_COS_MAX_UPLOAD_BYTES
```

If any required COS credential is set, all of `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_BUCKET`, and `TENCENT_COS_REGION` must be set.

Mail:

```text
MAIL_DRIVER
MAIL_HOST
MAIL_PORT
MAIL_FROM
MAIL_USER
MAIL_PASS
```

AI provider configuration:

```text
AI_PROVIDER
AI_ANALYSIS_API_KEY
AI_ANALYSIS_BASE_URL
AI_ANALYSIS_MODEL
AI_VISION_API_KEY
AI_VISION_BASE_URL
AI_VISION_MODEL
AI_LANGUAGE_API_KEY
AI_LANGUAGE_BASE_URL
AI_LANGUAGE_MODEL
AI_CHAT_API_KEY
AI_CHAT_BASE_URL
AI_CHAT_MODEL
AI_CHAT_COMPRESSION_API_KEY
AI_CHAT_COMPRESSION_BASE_URL
AI_CHAT_COMPRESSION_MODEL
AI_EMBEDDING_API_KEY
AI_EMBEDDING_BASE_URL
AI_EMBEDDING_MODEL
```

`AI_PROVIDER` currently supports only `openai-compatible`.

Each role is independent. If a role is configured, that role must provide all of
`BASE_URL`, `API_KEY`, and `MODEL`. Partial role configuration is rejected at startup.

Recommended role split:

- `AI_ANALYSIS_MODEL`: 今日分析、周报、月报等长文本分析生成
- `AI_VISION_MODEL`: 食物图片识别、睡眠检测截图理解等视觉入口
- `AI_LANGUAGE_MODEL`: 自然语言记一笔、口语化结构提取
- `AI_CHAT_MODEL`: 轻聊天页的主对话模型
- `AI_CHAT_COMPRESSION_MODEL`: 长对话摘要、压缩历史上下文的低成本模型
- `AI_EMBEDDING_MODEL`: RAG 检索向量化、知识库分片索引和查询向量生成

## Runtime Notes

- `pnpm export:openapi` disables `REDIS_URL` inside the export process so docs generation does not start Redis-backed cache or BullMQ connections.
- i18n type generation writes `src/generated/i18n.generated.ts` only in source-tree development runtime.
- When `REDIS_URL` is set, Lucent uses Redis through a Keyv-backed Nest cache store; without it, cache falls back to memory.
- Mail delivery uses BullMQ when `REDIS_URL` is set and immediate send when Redis is absent.
- WeChat Web OAuth state is cached for 10 minutes. Desktop login may include a loopback callback URI in OAuth state.
- Daily-record image uploads use presigned Tencent COS PUT URLs; clients upload directly to COS, then save returned attachment metadata on the daily record.
- Medicine search cache TTL is 5 minutes; medicine detail cache TTL is 15 minutes.
- Frontend reads may send `x-bypass-cache: true` to bypass medicine read cache for one request.
- `POST /api/v1/testing/fullstack-e2e/record-lane/prepare` exists only when Lucent runs with `NODE_ENV=test`. It is intentionally absent from normal development and production runtime, and is meant only to repair a dedicated full-stack test user plus clear that user's daily-record slice for one target date.

## CI/CD Boundary

`.github/workflows/deploy-server.yml` owns the CI/CD pipeline shape. For Tencent Cloud setup, registry variables, server bootstrap, and first deployment checks, use `tencent-cloud-cicd.md`.
