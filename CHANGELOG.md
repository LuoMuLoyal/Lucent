# Changelog

All notable changes to Lucent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Detailed daily entries live in `docs/02-logs/migration-log/` and
`docs/03-archive/migration-log/`. This file is the curated summary.

## [Unreleased]

### Added

#### Authentication & Security

- Credential login + WeChat (Web/Mobile) + Apple + QQ OAuth providers
- JWT access + refresh token rotation with `UserSession` tracking
- In-app 6-digit Security PIN replacing the former TOTP 2FA system
- `SecurityElevationGuard` and `@RequireSecurityElevation()` decorator
  protecting sensitive routes (password change, email change, identity
  management, data export)
- Short-lived signed elevation JWT (15 min) minted after PIN verification,
  invalidated on PIN enable/change/disable via `securityElevationVersion`
- `User.email` unique constraint at database level
- `@Public()` decorator for public routes (clinic summary share links)
- Auth rate limiting with login failure cache

#### Health Records & User Data

- Daily records: water, meal, vital, mood, symptom, activity, note, sleep
- User health context: allergies, conditions, current medicines, profile
- Medicine dose logs with `taken` / `skipped` / `missed` / `planned` statuses
- Medicine reminders with day-of-week scheduling and delivery tracking
- Daily record image attachments via Tencent COS signed URLs
- User settings with assistant configuration (enabled, memory, context sources)
- User notifications model with typed notification categories

#### AI Pipeline

- **Bounded-linear AI** (Context → Copy → Generator → Policy → Persistence):
  - Today analysis with SSE streaming
  - Report AI summary with SSE streaming
  - Natural-language daily-record candidate generation
- **Agent-based assistant** (LangGraph):
  - Bounded retrieval-loop runtime with `loopCount` / `selectedTools` /
    `retrievalEvidence` / `stopReason` state
  - Source-split RAG: Chinese leaflet retrieval, DrugBank entity-scoped
    passage search, medical QA corpus — three independent vector stores
  - Structured medicine lookup tools: `search_cn_medicine_products`,
    `get_cn_medicine_detail`, `get_drugbank_detail`
  - Proposal-only write tools: create/update/delete daily records, update
    settings — all require frontend confirmation
  - Persisted conversations with cross-conversation memory (optional,
    user-controlled)
- **Meal analysis** vision pipeline:
  - Two-phase: vision dish recognition + deterministic food-composition matching
  - Three-stage mixed-dish grounding: vision → dish decomposition →
    ingredient grounding into `food_composition_items`
  - Async worker via BullMQ with COS-signed GET URLs
  - `MealDishTemplate` learning on user-confirmed analyses
  - Safety filter on vision output (length limits, HTML/script stripping,
    `AiSafetyPolicyService` checks)
  - Downstream read-rule matrix: `analyzing` → plain record,
    `analysis_failed` → missing data, `unconfirmed`/`partial` → labeled as
    estimates
- `AiSafetyPolicyService` forbidding diagnosis / prescription / dosage output
- DeepSeek `thinking` mode auto-disabled for streaming tool-use flows
- Deterministic fallback copy when no `analysis` model is configured
- `LlmRuntimeModule` with role-based OpenAI-compatible model factory
  (analysis, vision, language, chat, chat-compression, embedding)

#### Medicine Knowledge Base

- DrugBank XML import: drugs, external links, targets with stable IDs
- Chinese medicine product + leaflet import with product-leaflet linking
- Medicine leaflet chunking and vector embedding pipeline
- DrugBank passage chunking and vector embedding pipeline
- Medical QA corpus import with safety-label filtering
- `pgvector/pgvector:pg18` baseline for local and CI PostgreSQL
- `searchText` columns for full-text search across medicine tables
- Import helper scripts with shared modules (`env.ts`, `stable-id.ts`,
  `db-upsert.ts`, `chunking.ts`)

#### Food Composition

- `food_composition_categories` and `food_composition_items` tables
- Import scripts for China food composition workbook
- `meal_dish_templates` and `meal_dish_template_ingredients` for
  conservative mixed-dish grounding

#### Reports & Data Export

- Report dashboard with metric computation, trends, findings, patterns
- AI summary generation with context, copy, generator, and safety layers
- Clinic summary with privacy-preserving masking and 24h Redis share links
- PDF export via pure `pdf-lib` (no HTML-to-PDF): data-dense layout with
  score breakdown, metric cards with sparklines, daily trend tables,
  insight blocks
- BullMQ async export with inline fallback and shared
  `DataExportProcessorService`
- `SecurityElevationGuard` on export request and download endpoints

#### Infrastructure

- `nestjs-pino` / `pino-http` structured logging with `X-Request-Id`
  propagation and `AsyncLocalStorage` request context
- AdminJS panel at `/admin` with auto-discovered Prisma resources
- Tencent COS integration for daily-record image uploads
- Nodemailer mail service with `log` driver for development
- nestjs-i18n with `AcceptLanguageResolver` for localized backend copy
- Health check endpoints: `/health`, `/health/live`, `/health/ready`,
  `/health/deep`
- Nginx reverse proxy (80 → 443 → app:3000) with TLS

#### CI/CD

- GitHub Actions CI: lint, typecheck, build, unit tests, e2e tests,
  OpenAPI export + semantic verification
- GitHub Actions CD: Docker image build → Tencent TCR push → SSH deploy
- `pgvector/pgvector:pg18` CI PostgreSQL service
- Deploy smoke test script (`pnpm deploy:smoke`)
- Deploy asset validation (`pnpm deploy:assets:check`)
- Test runtime helpers (`pnpm test:runtime:start` / `stop`)
- Full-stack E2E support route for Flutter integration tests

#### Project Health

- `ROADMAP.md` — four-phase evolution plan
- `SECURITY.md` — vulnerability reporting policy
- `CODE_OF_CONDUCT.md` — community standards
- `.editorconfig` — cross-editor consistency
- Issue templates (bug report, feature request) with config
- Pull request template with checklist
- `dependabot.yml` — npm/docker/actions auto-update with grouping
- `CODEOWNERS` — code ownership rules
- `CONTRIBUTING.md` — branch naming, commit convention, PR workflow
- ADR-0001 through ADR-0005

### Changed

- **Module structure**: full naming-deprefix + barrel exports + domain split
  across all 22 modules and `src/common/`
- **Prisma generated client** moved from `src/generated/` to root `generated/`
  with `#generated/*` subpath import
- **`common/` reorganized** by role: `helpers/`, `services/`, `logger/`,
  `api/`, `ai/`, `filters/`, `interceptors/`, `middleware/`, `constants/`,
  `validators/`
- **AuthService** split into account, OAuth facade, notification, token,
  credential, rate-limit sub-services
- **AdminJS setup** split into types, constants, and focused services
  (prisma-module, resource-config, resource-builder, static-asset,
  auth-router)
- **Assistant runtime** split into state, router, graph files
- **Assistant tools** reorganized into `drugbank/`, `leaflet/`, `records/`,
  `knowledge/`, `medicine/` subdirectories
- **Logging** migrated from Winston to Pino (`nestjs-pino` / `pino-http`)
- **API exception filter** resolved from DI instead of `new`-ed in bootstrap
- **`new Date()`** calls in business code replaced with centralized `now()` /
  `nowIsoString()` from `common/helpers/date-time.utils.ts`
- **Date parsing** in assistant tool date resolver replaced with `date-fns`
- **HTTP retries** centralized in `common/helpers/retry.utils.ts`
  (`withRetry`, `fetchWithRetry`)
- **Cosine/cos constants** centralized in `src/config/constants.ts`
- **Assistant cross-module deps** consumed through `assistant-ports.ts`
  interfaces and injection tokens
- **User setting keys** moved to `common/constants/user-setting-keys.ts`
  to break `common/ai` → `modules/` reverse dependency
- **BaseAiGeneratorService** depends on `LlmRuntimePort` interface instead of
  concrete `LlmRuntimeService`
- **OpenAPI CI gate** switched from raw `git diff` to semantic JSON comparison
- **pnpm baseline** raised from 10 to 11.x (CI pinned to 11.9.0)
- **`pnpm check`** chain now includes `format:check` and `deploy:assets:check`
- **Env file resolution** unified via `env-file-paths.ts` helper
  (`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` priority)
- **PDF export** switched from chart-based to data-dense table layout,
  removed `quickchart-js` dependency
- **Report export** uses shared `DataExportProcessorService` for both async
  and inline paths
- **`package.json`** scripts deduplicated (`test:e2e:ci`, `db:migrate`,
  `dev:stack:up`, `db:migrate:all`)

### Fixed

- `AuthTokenService.refresh()` non-atomic operation: now creates new session
  before deleting old one
- `CacheConfigService.mset()` bug: `Object.entries()` on array entries
  replaced with correct mapping
- `DailyRecordsController` pagination params: `string` → `number` with
  `@IsInt` / `@Min` / `@Max` validation
- `AssistantController.streamMessages` internal error leakage: non-HttpException
  messages no longer sent to client via SSE
- `ReportsController.generateSummaryStream` error leakage: same fix
- `TodayAnalysisController.generateStream` error leakage: same fix
- `AssistantConversationService` title truncation bug: template literal
  with single quotes produced literal string instead of truncating
- `MealIngredientGroundingService` full-table scan: added indexed `startsWith`
  predicate on `normalizedName`/`searchText`
- `commonCharacterCount` duplicate-counting bug: replaced with
  character-frequency maps
- `rebuild-drugbank-rag-index.ts` SQL injection: LIMIT clause changed from
  string interpolation to parameterized query
- `rebuild-leaflet-index.ts` SQL injection: same fix
- Auth silent catch blocks: added `logger.warn` / `logger.error` before
  swallowing errors in notification, SSE, health probe, and export paths
- `HealthContextProfile` upsert: `onboardingCompletedAt` now written on both
  create and update branches
- `normalizeEmail` duplication: extracted to shared `common/helpers/string.utils.ts`
- `loginFailureCacheKey` duplication: extracted to shared function
- `SecurityPinService` argon2 config: unified with `auth/config/argon2-options.ts`
- Registration response missing `avatar` and `updatedAt` fields
- Script `require()` calls: removed `.ts` extensions (Node 24 auto-resolves)
- `tsconfig.json` `ignoreDeprecations` adjusted for TypeScript 5.7
- `pnpm typecheck:tools` failure: `scripts/tsconfig.json` and `deploy/tsconfig.json`
  now inherit root decorator settings

### Removed

- TOTP 2FA system (`twoFactorEnabled`, `twoFactorSecret`, `twoFactorRecoveryCodes`,
  `AuthTwoFactorService`, `two-factor.dto.ts`)
- `match_cn_product_to_drugbank_candidates` assistant bridge tool (product
  decision: handwritten alias bridge not sustainable)
- Campus-scoped support resources (no reliable school-specific data source)
- `report-chart.service.ts` and `quickchart-js` dependency (replaced by
  data-dense PDF layout)
- `nest-winston` / `winston` / `winston-daily-rotate-file` (replaced by Pino)
- Stale `medicine_source_matches` from recommended durable tables
- Legacy Gitee Go deployment path
- Old `monitoring/` tracked repo assets (Prometheus/Grafana provisioning)
- `aiChat*` compatibility setting keys (replaced by `assistant*` naming)

### Security

- `User.email` unique constraint at database level
- `SecurityElevationGuard` on sensitive routes
- `AiSafetyPolicyService` on all AI output (final + streamed chunks)
- Vision safety filter on meal analysis (length limits, HTML/script stripping,
  forbidden-pattern rejection)
- Assistant internal error messages no longer leaked via SSE
- SQL injection fixes in RAG index rebuild scripts
- No hardcoded credentials in code (env-based secret management)
- `AiSafetyPolicyService` forbids diagnosis, prescription, dosage adjustment,
  and treatment-plan wording in all AI output

---

## Version History

Lucent has not yet published a stable release. All work to date is tracked
under `[Unreleased]` and will be assigned a version when the
[Production Readiness](ROADMAP.md#production-readiness--v100) milestone
is reached.
