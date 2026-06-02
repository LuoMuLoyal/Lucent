# Lucent Changelog

> 历史条目保留当时状态，可能包含已经废弃的端口、脚本或目录说明。
> 当前运行方式以 `README.md`、`docs/README.md`、`docs/environment.md` 为准。

## 2026-06-02 (Auth Validation Code Alignment + UpdateMe Empty-String Clearing)

### Fixed

- `src/setup-app.ts`
  - 全局 `ValidationPipe` 现在通过自定义 `exceptionFactory` 把 DTO 校验错误稳定映射到 `400002`，与当前合同文档一致。
- `src/auth/auth.service.ts`
  - `updateMe` 现在把 `nickname: ''` / `avatar: ''` 解释为清空字段，并以 `null` 持久化，真实行为对齐 auth 文档。
- `src/auth/dto/register.dto.ts`
  - `nickname` 补上 `MinLength(1)`，使 DTO 约束与“1-20 字符”的合同说明一致。
- `src/auth/auth.service.spec.ts`
  - 新增 `updateMe` 空字符串清空断言。
- `test/auth.e2e-spec.ts`
  - `register` 缺少必填字段时现在显式断言返回 `400002`。
  - 新增 `PATCH /auth/me` 空字符串清空昵称/头像的 e2e 覆盖。

### Changed

- `docs/auth-api-mock.md`
  - `PATCH /auth/me` 的 `avatar` 描述改为“头像字符串”，避免误导成当前后端会做 URL 校验。

### Test Results

- 待本次改动验证

## 2026-06-02 (Auth Logout Boundary + Normalized Change Email Response)

### Fixed

- `src/auth/auth.service.ts`
  - `logout` 现在把 `refreshToken` 删除约束在当前 JWT 用户名下，不再允许一个已认证用户仅凭别人的 refresh token 明文就删除对方 session。
  - `changeEmail` 现在返回更新后的 `User`，供控制器回显真实持久化结果。
- `src/auth/auth.controller.ts`
  - `POST /api/v1/auth/logout` 现在把 `CurrentUser().sub` 传给 service，落实当前账号边界。
  - `POST /api/v1/auth/me/email` 现在返回规范化后的最终邮箱值，而不是原始 `dto.newEmail`。
- `test/auth.e2e-spec.ts`
  - 新增“跨账号 logout 不应删掉 чужой refresh session”覆盖。
  - 新增“changeEmail 响应应返回 lowercase 规范化邮箱”覆盖。
- `src/auth/auth.service.spec.ts`
  - 同步断言 `logout` 只按 `userId + refreshTokenHash` 删除 session。
  - 同步断言 `changeEmail` 返回更新后的规范化邮箱。

### Changed

- `docs/auth-api-mock.md`
  - 补充 logout 的当前账号边界说明。
  - 补充 changeEmail 响应返回规范化邮箱的说明。

### Test Results

- `pnpm test -- auth.service.spec.ts` — 通过
- `pnpm test:e2e -- auth.e2e-spec.ts` — 通过
- `pnpm export:openapi` — 通过

## 2026-05-31 (Medicines Cache Invalidation + OpenAPI Export Sync)

### Fixed

- `src/medicines/cache/medicines-cache-admin.service.ts` 现在按 Nest cache runtime 的真实 `Keyv -> KeyvAdapter -> raw store` 结构扫描药品缓存键，不再假设 `cache.stores` 直接暴露 `keys()`；`invalidateAll()` 现在能删除 Redis-backed medicines cache。
- `scripts/medicine/import-medicine-knowledge.js` 现在会同时扫描 Keyv namespace 前缀下的 Redis key 和未加 namespace 的回退模式，并在删除前归一化为逻辑 `medicines:*` key，避免导入后误报 `invalidated: 0` 但旧缓存仍保留。
- `docs/openapi.json` 重新导出并保留 medicines endpoints 上的 `x-bypass-cache` header 参数，避免 Lucent 已提交契约落后于控制器声明。

### Added

- `src/medicines/cache/medicines-cache-admin.service.spec.ts` 改为覆盖真实 Keyv-backed store 形状和 namespace key 归一化逻辑。
- `scripts/medicine/import-medicine-knowledge.test.js` 新增 Node-level 脚本测试，覆盖 namespaced cache key 扫描、归一化和去重。

### Changed

- `docs/environment.md` 把导入脚本缓存失效说明更新为与 Keyv namespace 行为一致的描述。

### Test Results

- `pnpm exec jest --runInBand src/config/cache.config.spec.ts src/medicines/cache/medicines-cache-admin.service.spec.ts` — 通过
- `node --test scripts/medicine/import-medicine-knowledge.test.js` — 通过
- `pnpm export:openapi` — 通过

## 2026-05-31 (Cache Manager Redis Wiring + Agent Doc Cleanup)

### Fixed

- `src/config/cache.config.ts` 改为适配 NestJS 11 当前缓存接口：
  - 使用 `stores` 而不是旧的 `store` 字段
  - Redis store 通过 Keyv adapter 接入，避免全局缓存管理器配置成看似启用 Redis、实际不受当前 Nest cache API 正确消费的状态
  - 继续保留 `REDIS_URL` 缺失时的内存缓存回退
- `src/config/cache.config.spec.ts` 新增缓存配置测试，覆盖：
  - 无 `REDIS_URL` 的内存回退
  - `redis://` URL 的 host / port / password / db 解析
  - `rediss://` URL 的 TLS 启用

### Changed

- `docs/environment.md` 补充当前缓存管理器的 Redis / memory 回退行为。
- `docs/public/data-sources.md` 明确写清 DrugBank `full database.xml` 不走 `xlsx` 中转导入路径。
- `AGENTS.md` 收敛为项目事实、文档入口、工作规则和已知坑，移除泛化程度过高的信息。

### Test Results

- `pnpm exec jest --runInBand src/config/cache.config.spec.ts src/auth/verification-code.service.spec.ts` — 通过
- `pnpm build` — 通过

## 2026-05-31 (Medicines Read Cache)

### Added

- `src/medicines/cache/medicines-cache.service.ts`：药品 search/detail 统一缓存入口，负责 source-aware key 生成与 TTL 管理。
- `src/medicines/cache/medicines-cache.service.spec.ts`：覆盖 search/detail cache hit/miss 和 key 规则。

### Changed

- `src/medicines/medicines.service.ts` 现在通过服务层缓存包装 medicines search/detail，而不是依赖控制器层默认 URL cache key。
- `src/medicines/medicines.module.ts` 注册 `MedicinesCacheService`。
- `src/medicines/medicines.service.spec.ts` 同步缓存接入后的调用边界。
- `docs/environment.md` 记录当前 medicines 缓存前缀与 TTL。

### Test Results

- `pnpm exec jest --runInBand src/medicines/cache/medicines-cache.service.spec.ts src/medicines/medicines.service.spec.ts` — 通过
- `pnpm exec eslint --fix --no-warn-ignored src/medicines/cache/medicines-cache.service.ts src/medicines/cache/medicines-cache.service.spec.ts src/medicines/medicines.service.ts src/medicines/medicines.service.spec.ts src/medicines/medicines.module.ts` — 通过
- `pnpm build` — 通过

## 2026-05-31 (Medicines Cache Bypass + Import Invalidation)

### Added

- `src/medicines/cache/medicines-cache.constants.ts`：统一 medicines cache 前缀、TTL 和 bypass header 常量。
- `src/medicines/cache/medicines-cache-admin.service.ts`：提供 medicines cache key 扫描和失效入口。
- `src/medicines/cache/medicines-cache-admin.service.spec.ts`：覆盖 medicines cache 删除逻辑。

### Changed

- `src/medicines/medicines.controller.ts` 支持 `x-bypass-cache` 请求头，仅绕过当前读请求缓存。
- `src/medicines/medicines.service.ts` / `src/medicines/cache/medicines-cache.service.ts` 新增 bypass 参数支持。
- `scripts/medicine/import-medicine-knowledge.js` 在导入完成后会清理 Redis 中的 `medicines:*` key。
- `docs/environment.md` 与 `docs/public/api-contract.md` 同步 bypass / invalidate 语义。

### Test Results

- `pnpm exec jest --runInBand src/medicines/cache/medicines-cache-admin.service.spec.ts src/medicines/cache/medicines-cache.service.spec.ts src/medicines/medicines.service.spec.ts` — 通过
- `pnpm exec eslint --fix --no-warn-ignored src/medicines/cache/medicines-cache.constants.ts src/medicines/cache/medicines-cache-admin.service.ts src/medicines/cache/medicines-cache-admin.service.spec.ts src/medicines/cache/medicines-cache.service.ts src/medicines/cache/medicines-cache.service.spec.ts src/medicines/medicines.controller.ts src/medicines/medicines.service.ts src/medicines/medicines.service.spec.ts src/medicines/medicines.module.ts scripts/medicine/import-medicine-knowledge.js` — 通过
- `pnpm build` — 通过

## 2026-05-30 (Medicine Knowledge Foundation - Source-Aware API + Durable Tables)

### Added

- `prisma/schema.prisma` 新增药品知识层持久化模型：
  - `drug_source_imports`
  - `cn_medicine_products`
  - `drugbank_drugs`
  - `drugbank_external_links`
  - `drugbank_targets`
  - `drugbank_drug_targets`
- 新增迁移 `prisma/migrations/20260530233000_add_medicine_knowledge`。
- `src/medicines/` 新增 source-aware feature-first 模块，提供：
  - `GET /api/v1/medicines`
  - `GET /api/v1/medicines/:id`
- Search API 统一返回 common card shell；detail API 返回 `drugbank` / `cnProduct` 的 source-specific payload。
- 新增 `src/i18n/en/medicine.json` 与 `src/i18n/zh-CN/medicine.json`，覆盖无效来源和药品不存在场景。
- 新增 `src/medicines/medicines.service.spec.ts` 与 `test/medicines.e2e-spec.ts`。
- 新增药品知识导入链路：
  - `scripts/medicine/import-medicine-knowledge.js`
  - `scripts/medicine/parsers/`
  - `scripts/dev/import-medicine-datasets.ps1`
  - `scripts/medicine/requirements.txt`

### Changed

- `src/app.module.ts` 注册 `MedicinesModule`。
- `docs/public/api-contract.md` 从“planned”推进到当前已实现的 medicines endpoints。
- `docs/public/data-sources.md` 补充实际导入建议：
  - `FullDrugDetail.xlsx` / CSV 适合 DBeaver 等工具导入
  - DrugBank `full database.xml` 继续推荐脚本化、可重复导入
- 导入脚本现在会把每次运行写入 `drug_source_imports`，支持 source version / file hash / rejection sample 元数据。
- Target 导入现在显式生成稳定主键，并在 target + relation 批次内使用事务，避免 `drugbank_targets` / `drugbank_drug_targets` 插入失败。
- `drugbank_targets` 导入补充保留 `Actions` / `Known Action` 到关系表。
- `docs/README.md` 将 `public/data-sources.md` 提升为药品库变更的主文档入口。

### Test Results

- `pnpm exec prisma generate` — 通过
- `NODE_ENV=test pnpm exec prisma migrate deploy` — 通过
- `pnpm exec jest --runInBand src/medicines/medicines.service.spec.ts` — 通过
- `pnpm exec jest --runInBand --config ./test/jest-e2e.json test/medicines.e2e-spec.ts` — 通过
- `pnpm build` — 通过

## 2026-05-30 (Dual Local PostgreSQL + Local Stack Scripts)

### Changed

- `docker-compose.dev.yml` 现在拆分为两个本地 PostgreSQL 服务：
  - `postgres-dev` → `127.0.0.1:15432`，供 `NODE_ENV=development` 使用
  - `postgres-test` → `127.0.0.1:5432`，供 `NODE_ENV=test` / e2e 使用
- `.env.development.example` 更新为开发库端口 `15432`。
- `eslint.config.mjs` 忽略 `scripts/**/*.js`，解决编辑器对 `scripts/export-openapi.js` 的 project-service 解析报错。
- `scripts/dev/up-local-stack.ps1` 现在带 `--remove-orphans`，减少旧单库容器残留导致的 5432 端口冲突。

### Added

- `scripts/dev/up-local-stack.ps1`：启动本地 dev/test PostgreSQL 和 Redis。
- `scripts/dev/down-local-stack.ps1`：停止本地 stack，可选删除 volumes。
- `scripts/dev/migrate-local-databases.ps1`：生成 Prisma client，并依次迁移 development/test 数据库。
- `package.json` 新增：
  - `pnpm dev:stack:up`
  - `pnpm dev:stack:down`
  - `pnpm db:migrate:dev`
  - `pnpm db:migrate:test`
  - `pnpm db:migrate:all`

### Docs

- `README.md` 与 `docs/environment.md` 同步本地双数据库布局和新脚本用法。

## 2026-05-30 (User Domain 第二层 - Health Context 聚合读取)

### Added

- `src/user-health-context/` 新增 feature-first 模块，提供 `GET /api/v1/me/health-context`。
- 聚合读取当前登录用户的 `profile`、`allergies`、`conditions`、`currentMedicines`，并返回 `summary`。
- `summary` 当前包含年龄、onboarding 完成状态、活跃过敏数量、条件数量、当前用药数量和缺失核心 profile 字段列表。
- 输出层统一把 `@db.Date` 字段映射为 `YYYY-MM-DD`，时间戳映射为 ISO 8601 字符串，避免前端直接面对 Prisma `Date` 对象。
- 新增 `src/user-health-context/user-health-context.service.spec.ts` 与 `test/user-health-context.e2e-spec.ts`，覆盖空 profile 回退、聚合映射和 JWT 认证读取场景。

### Changed

- `src/app.module.ts` 注册 `UserHealthContextModule`。
- `docs/backend-user-domain.md` 与 `docs/public/api-contract.md` 同步新增当前 health-context API 边界说明。

### Test Results

- `pnpm exec jest --runInBand src/user-health-context/user-health-context.service.spec.ts` — 通过
- `pnpm exec jest --runInBand --config ./test/jest-e2e.json test/user-health-context.e2e-spec.ts` — 通过
- `pnpm build` — 通过

## 2026-05-30 (Auth 注册验证码、邮箱变更与刷新令牌修正)

### Fixed

- `register` 现在要求 `code`，并校验 `scene=register` 的邮箱验证码；注册成功后邮箱直接标记为已验证。
- `changeEmail` 改为校验发往新邮箱的验证码，不再用旧邮箱验证码确认新邮箱归属。
- `changeEmail` 由 JWT 用户身份确认当前账号边界，request body 不再接收 `currentEmail`。
- `refresh` 只轮换当前 refreshToken，不再删除同账号其他设备的 refreshToken。
- `export:openapi` 改为先构建再从 `dist` 导出，避免 ts-node 无法解析 Prisma 7 生成客户端 `.js` import。
- `test/auth.e2e-spec.ts` 移除验证码读取处的非空断言，并集中 auth path、验证码场景、测试密码、测试邮箱和 Bearer header 等测试常量，避免 pre-commit ESLint 被硬编码和 `no-non-null-assertion` 卡住。

### Test Results

- `pnpm build` — 通过
- `pnpm test` — 6 suites / 67 tests 通过
- `pnpm test:e2e` — 2 suites / 31 tests 通过
- `pnpm export:openapi` — 通过
- `pnpm test -- auth.service.spec.ts` — 通过
- `flutter analyze` — 通过
- `flutter test` — 通过

---

## 2026-05-30 (文档边界重整)

### Changed — 文档入口与更新规则

- 新增 `docs/README.md` 作为 Lucent 文档地图，明确 README、CHANGELOG、API contract、环境文档、产品 roadmap 与归档文档的边界。
- 更新 `README.md`、`AGENTS.md` 和 `docs/public/README.md`，把“每次代码变更按文档边界更新对应文档”写入协作规则。
- 标记 `docs/auth-implementation-plan.md` 与 `docs/migration-roadmap.md` 为归档/参考文档，避免继续作为当前进度来源。
- 保留历史 changelog 内容，但明确旧端口、脚本或目录说明以当前 README / environment 文档为准。

---

## 2026-05-30 (Auth 安全边界 + E2E 基线修复)

### Fixed — 登录凭据校验安全修复

- **`src/auth/auth.service.ts`**
  - 修复 `login` 在只传邮箱、不传 `password` / `code` 时仍会签发 token 的问题。
  - 明确约束登录凭据必须且只能二选一：密码登录或验证码登录。
  - 修复 JWT 签发时 payload 已含 `sub` 又传 `subject` 导致 jsonwebtoken 9 抛错的问题。
- **`src/auth/auth.service.spec.ts`**
  - 新增空凭据、双凭据登录拒绝测试。

### Fixed — 软删除用户查询边界

- **`src/user/user.service.ts`**
  - `findById` / `findByEmail` 改为默认只返回 `deletedAt = null` 的用户。
  - 注销账号后的用户不再参与登录、`me` 查询和邮箱占用判断。
- **`src/user/user.service.spec.ts`**
  - 同步断言查询条件包含 `deletedAt: null`。

### Fixed — E2E 测试运行条件

- **`package.json`**
  - `test:e2e` 增加 `NODE_OPTIONS=--experimental-vm-modules`，适配 Prisma 7 生成客户端加载 `.mjs` query compiler。
- **`.env.test`**
  - 本地测试数据库连接对齐 `docker-compose.dev.yml`：`lucent/lucent_dev@127.0.0.1:5432/lucent`。
- **`src/i18n/i18n.module.ts`**
  - `typesOutputPath` 仅在 `NODE_ENV=development` 启用，避免 test / dist 运行时访问缺失的 `dist/generated/i18n.generated.ts`。
- **`src/app.service.ts`**
  - `GET /api/v1/health` 保持统一 envelope：`{ code: 0, message: '', data: {} }`，不额外塞业务 payload。
- **`test/auth.e2e-spec.ts`**
  - 将未发送验证码时的 change-email 错误期望对齐到 `400 / 400100`。

### Test Results

- `pnpm build` — 通过
- `pnpm test` — 6 suites / 67 tests 通过
- `pnpm test:e2e` — 2 suites / 30 tests 通过

---

## 2026-05-29 (OpenAPI 全量导出 + Flutter dio 客户端生成)

### Fixed — 循环依赖导致 openapi.json 不完整

- **`src/auth/auth.controller.ts`**
  - 修复 `AuthController` 通过 `ApiResponse` 装饰器引用 `UserFullDto`（位于 `src/users/dto/`）导致的循环依赖问题
  - `UserFullDto` 在 `auth-responses.dto.ts` 中重新定义内联版本，或通过 `UsersModule` 导出 `UserFullDto` 解决依赖链
- **`scripts/export-openapi.ts`**
  - 修复后重新导出，openapi.json 从 4 paths / 20 schemas 扩展为 **12 paths / 29 schemas**
  - 覆盖全部 Auth 端点（register/login/logout/refresh/me 等）和 App 端点（用户信息/密码/邮箱）

### Added — Flutter Dio 客户端代码生成

- **`docs/openapi.json`** — 完整 OpenAPI 3.0 规范（12 paths, 29 schemas）
- **`package.json`** — `export:openapi` 脚本已稳定，`pnpm export:openapi` 一键导出
- **Flutter 端** — 使用 `openapi-generator-cli`（`dart-dio` 生成器）生成完整客户端
  - 生成路径：`Luminous/lib/api/generated/`
  - 包：`luminous_api`（built_value + dio 序列化）
  - API 客户端：`AuthApi`（13 个端点）、`AppApi`（6 个端点）
  - Model DTO：29 个（LoginDto, RegisterDto, UserBriefDto, UserFullDto, TokensDto 等）
  - 拦截器：`BearerAuthInterceptor`（JWT token 自动注入）
  - `build_runner` 生成 60 个序列化输出文件

---

## 2026-05-28 (OpenAPI 导出脚本)

### Added

- **`scripts/export-openapi.ts`** — 独立 OpenAPI 3.0 规范导出脚本
  - 启动 NestJS 应用（无日志），调用 `SwaggerModule.createDocument()` 生成完整 OpenAPI JSON
  - 输出到 `docs/openapi.json`，可直接用于 openapi-generator 生成客户端代码
  - 统计并打印 paths 和 schemas 数量
- **`package.json`** — 新增 `export:openapi` 脚本
  - 命令：`pnpm export:openapi`
  - 使用 `ts-node` + `tsconfig-paths` 注册运行，`NODE_ENV=development`

---

## 2026-05-28 (Docker Build Fix)

### Fixed

- `src/auth/strategies/jwt-access.strategy.ts` — 移除未使用的 `configService` 参数的 `private` 修饰符（TS6138: 值从未被读取）
- `src/config/jwt.config.ts` — 修复 `match[2]` 在 `noUncheckedIndexedAccess` 下可能为 `undefined` 的问题（改用 `?.` 可选链 + 缩小类型为 `'s' | 'm' | 'h' | 'd'`）
- `src/i18n/i18n.module.ts` — 移除未使用的 `I18nService` import 和构造函数参数（TS6138）；添加 `@typescript-eslint/no-extraneous-class` 行内禁用注释
- `src/prisma/prisma.service.ts` — 移除未使用的 `configService` 参数的 `private` 修饰符（TS6138）
- `prisma.config.ts` — 修复 `exactOptionalPropertyTypes` 报错（`process.env['DATABASE_URL']` 可能为 `undefined`，改为 `?? ''` fallback）

### Changed

- `Dockerfile` — production stage 改为安装全部依赖（含 `prisma` CLI），因为 `docker-entrypoint.sh` 需要运行 `prisma migrate deploy`；添加注释说明 i18n 翻译文件由 `nest build` assets 配置复制到 `dist/`
- `docker-entrypoint.sh` — `npx` 改为 `pnpm exec`（与 pnpm 项目保持一致）

## 2026-05-28 (OpenAPI 响应 DTO + @ApiResponse 装饰器)

### Added — Auth 响应 DTO

- **`src/auth/dto/responses/common.dto.ts`** — 公共响应模型
  - `UserBriefDto` — 简略用户信息（id, email, nickname, emailVerified, createdAt）
  - `UserFullDto` — 完整用户信息（id, email, nickname, avatar, emailVerified, createdAt, updatedAt）
  - `TokensDto` — 令牌信息（accessToken, refreshToken, expiresIn）
  - `CooldownMessageDto` — 冷却提示（cooldown, message）
- **`src/auth/dto/responses/auth-responses.dto.ts`** — 各端点响应 envelope DTO
  - `SuccessResponseDto` — data 为 null 的通用成功响应（logout / resetPassword / changePassword / deleteAccount）
  - `RegisterResponseDto` / `LoginResponseDto` / `RefreshResponseDto`
  - `SendVerificationCodeResponseDto` / `VerifyEmailResponseDto` / `ForgotPasswordResponseDto`
  - `MeResponseDto` / `ChangeEmailResponseDto`
- **`src/auth/dto/responses/index.ts`** — 统一导出

### Changed — AuthController @ApiResponse 装饰器

- **`src/auth/auth.controller.ts`**
  - 13 个端点全部添加 `@ApiResponse({ status, type })` 装饰器
  - 新增 `ApiResponse` 导入和 9 个响应 DTO 导入
  - Swagger JSON 现包含完整的请求/响应类型定义，可直接用于 openapi-generator 生成 Dart 客户端

## 2026-05-28 (i18n 国际化集成 + ESLint 修复)

### Added — nestjs-i18n 国际化框架

- **依赖新增** — `nestjs-i18n@^11`
- **I18nModule** (`src/i18n/i18n.module.ts`)
  - `I18nModule.forRoot()` — HeaderResolver 提取 `Accept-Language`，fallback 语言 `zh-CN`
  - Loader: `src/i18n/{lang}/{module}.json` 按模块拆分
- **翻译文件**
  - `src/i18n/zh-CN/auth.json` — 认证相关中文翻译（16 个 key）
  - `src/i18n/zh-CN/common.json` — 通用错误中文翻译
  - `src/i18n/en/auth.json` — 认证相关英文翻译
  - `src/i18n/en/common.json` — 通用错误英文翻译
- **`nest-cli.json`** — `compilerOptions.assets` 配置 `i18n/**/*.json` 编译时复制
- **`app.module.ts`** — 注册 `I18nModule`

### Changed — AuthService / VerificationCodeService i18n 重构

- **`src/auth/auth.service.ts`**
  - 注入 `I18nService`（nestjs-i18n），替换所有硬编码中文错误消息为 `this.i18n.t('auth.xxx', { lang })`
  - `lang` 从 `this.i18n.resolveLanguage(lang)` 获取（支持 Header 兜底）
  - 涉及方法：register / login / refresh / getMe / changePassword / changeEmail / deleteAccount / sendVerificationCode / verifyEmail / forgotPassword / resetPassword
- **`src/auth/verification-code.service.ts`**
  - 注入 `I18nService`，替换 cooldown 和验证码过期/错误的硬编码消息

### Fixed — ESLint 修复

- **`src/setup-app.ts`** (第 23 行)
  - `res.statusCode` 和 `duration`（`number` 类型）在模板字面量中改为 `String()` 包装
  - 修复 `@typescript-eslint/restrict-template-expressions` 报错
- **`src/app.module.ts`**
  - 空类 `AppModule` 添加 `// eslint-disable-next-line @typescript-eslint/no-extraneous-class` 行内禁用
  - NestJS `@Module()` 装饰器要求 class 声明，此规则属于误报

### Added — 单元测试

- **`src/common/api-envelope.spec.ts`** — `successEnvelope` / `errorEnvelope` 函数测试 + `ResultCode` 枚举唯一性校验
- **`src/common/interceptors/api-envelope.interceptor.spec.ts`** — `ApiEnvelopeInterceptor` 测试（plain data 包装 / null / undefined / 已有 envelope 透传 / 原始类型 / 数组）
- **`src/common/middleware/request-id.middleware.spec.ts`** — `requestIdMiddleware` 测试（无 header 生成 UUID / 自定义 header 透传 / trim / 空白 / next 调用 / 响应头设置）
- **`src/user/user.service.spec.ts`** — `UserService` 测试（findById / findByEmail / create / update / updateByEmail，mock PrismaService）
- **`src/auth/verification-code.service.spec.ts`** — `VerificationCodeService` 测试（send 生成码+缓存+发邮件 / cooldown 限制 / verify 正确码 / 过期码 / 错误码 / 缓存 key 格式）

### Test Results

- 6 suites, 65 tests — 全部通过 ✅

---

## 2026-05-28 (环境变量 & Docker 架构重构)

### Changed — 去掉公共 `.env`，改为单文件自包含

- **`src/config/env-file-paths.ts`**
  - 加载链从 `.env.{NODE_ENV}.local → .env.{NODE_ENV} → .env.local → .env` 精简为 `.env.{NODE_ENV}.local → .env.{NODE_ENV}`
  - 每个环境的 `.env.<NODE_ENV>` 文件自包含所有变量（含 HOST, PORT, CORS_ORIGIN 等公共项）
  - 删除 `.env` 和 `.env.example`

### Changed — Docker Compose 环境变量注入

- **`docker-compose.yml`**
  - `app` 服务的 `env_file` 从 `.env.docker`（已删除）改为 `.env.development`
  - 新增 `environment` 覆盖容器间连接地址：`DATABASE_URL` → `postgres:5432`，`REDIS_URL` → `redis:6379`
  - postgres 凭证统一为 `lucent/lucent_dev`，与 `.env.development` 一致

### Changed — `.env.*` 文件补全

- **`.env.development`** / **`.env.production`** / **`.env.test`**
  - 补充公共变量：`HOST`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `LOG_LEVEL`
- **`.env.test`** — 独立配置，DATABASE_URL 指向 Docker PostgreSQL（端口 15432），不设 REDIS_URL（fallback 内存缓存）

### Updated — 文档

- **`docs/environment.md`** — 反映新的单文件自包含结构和加载顺序
- **`.env.development.example`** / **`.env.production.example`** — 同步所有变量

---

## 2026-05-28 (OpenAPI + 运行时修复 + 日志滚动)

### Added — OpenAPI / Swagger 文档

- **Swagger 配置** (`src/setup-app.ts`)
  - `@nestjs/swagger` 集成，路径 `/api/docs`
  - `SwaggerModule.setup()` 自动生成 OpenAPI 3.0 规范
  - 所有 Auth DTO 添加 `@ApiProperty()` 装饰器（14 个文件）
- **依赖新增** — `@nestjs/swagger@^11`

### Added — Winston 日志按天滚动

- **日志文件输出** (`src/common/logger/logger.config.ts`)
  - 新增 `winston-daily-rotate-file` transport
  - `app-YYYY-MM-DD.log` — 全量日志，按天滚动
  - `error-YYYY-MM-DD.log` — 仅 error 级别，独立归档
  - 滚动策略：`maxSize: 20m`，`maxFiles: 30d`，`zippedArchive: true`
  - 日志目录：项目根 `logs/`（已被 `.gitignore` 覆盖）
- **依赖新增** — `winston-daily-rotate-file@^5`

### Fixed — Prisma v7 运行时兼容

- **PrismaService** (`src/prisma/prisma.service.ts`)
  - Prisma v7 不再自动读取 `DATABASE_URL`，需显式传递 adapter
  - 安装 `@prisma/adapter-pg`，使用 `new PrismaPg({ connectionString })` 构造 adapter
  - `super({ adapter })` 替代旧的 `super()` 调用
- **依赖新增** — `@prisma/adapter-pg@^7.8.0`

### Fixed — 环境变量校验

- **environment.validation.ts** (`src/config/environment.validation.ts`)
  - `DATABASE_URL` / `REDIS_URL` 的 Joi `.uri({ scheme: regex })` 改为 `.uri({ scheme: ['postgres', 'postgresql'] })`（Joi v18 不支持 regex）
  - `AI_*` / `MAIL_*` 可选字段添加 `.allow('')`，兼容 `.env` 中的空值
  - `CORS_ORIGIN` 添加 `.allow('')`

---

## 2026-05-27 (Auth Step 3 — 密码 & 账号管理)

### Changed — 桩实现替换为真实实现

- **AuthService** (`src/auth/auth.service.ts`)
  - `forgotPassword` — 发送重置密码验证码（`reset-password` scene），安全策略：无论邮箱是否存在都返回成功提示（防邮箱枚举攻击）
  - `resetPassword` — 验证码校验 + argon2id 哈希新密码 + 登出所有设备
  - `changeEmail` — 新增 `currentEmail` 验证码校验（`change-email` scene），防止未授权修改邮箱
  - `deleteAccount` — 从硬删除改为软删除（`deletedAt = new Date()`），保留数据可恢复性

### Changed — ChangeEmailDto 扩展

- **ChangeEmailDto** (`src/auth/dto/change-email.dto.ts`)
  - 新增 `currentEmail` 字段（`@IsEmail`，必填）— 用于验证当前邮箱的验证码

### Changed — AuthController 异步化

- **AuthController** (`src/auth/auth.controller.ts`)
  - `forgotPassword` / `resetPassword` 改为 `async`，正确 `await` AuthService 返回值

---

## 2026-05-27 (Auth Step 0 — 数据库基础设施)

### Added — Prisma + PostgreSQL 设置

- **Prisma Schema** (`prisma/schema.prisma`)
  - `User` 模型：id, email (unique), password, nickname, avatar, emailVerified, deletedAt, createdAt, updatedAt
  - `RefreshToken` 模型：id, token (unique), userId, expiresAt, createdAt，外键关联 User（级联删除）
  - Generator 输出到 `src/generated/prisma`，使用 `prisma-client` provider (Prisma v7)
  - Datasource: PostgreSQL，URL 从环境变量读取

- **prisma.config.ts**
  - 手动加载 `.env.development` → `.env`（dotenv），解决 Prisma CLI 无法读取环境差异文件的问题
  - DATABASE_URL 从 `process.env['DATABASE_URL']` 获取

- **PrismaService** (`src/prisma/prisma.service.ts`)
  - 继承 `PrismaClient`，实现 `OnModuleInit` / `OnModuleDestroy`
  - 模块初始化时 `$connect()`，销毁时 `$disconnect()`

- **PrismaModule** (`src/prisma/prisma.module.ts`)
  - `@Global()` 全局模块，导出 PrismaService
  - 已在 AppModule 中注册

- **Docker PostgreSQL 容器**
  - 容器名：`lucent-postgres`，镜像：`postgres:16-alpine`
  - 端口映射：`127.0.0.1:15432:5432`（Hyper-V 占用 5432，改用 15432）
  - 用户/密码/数据库：postgres/postgres/lucent

- **数据库迁移**
  - `prisma migrate dev --name init` 成功创建 `users` 和 `refresh_tokens` 表

- **Prisma Client 生成**
  - `prisma generate` 输出到 `src/generated/prisma/`

- **依赖变更**
  - 新增 `dotenv` (devDependency) — prisma.config.ts 需要

### Changed — 环境配置

- `.env.development` — `DATABASE_URL` 端口从 `5432` 改为 `15432`

---

## 2026-05-27 (Auth Step 1.5 — 验证码服务)

### Added — VerificationCodeService 真实实现

- **VerificationCodeService** (`src/auth/verification-code.service.ts`)
  - `send(email, scene)` — 生成 6 位随机验证码（`crypto.randomInt`），存入 Cache，调用 MailService 发送邮件
  - `verify(email, code, scene)` — 从 Cache 校验验证码，一次性（校验后删除）
  - 频率限制：60s cooldown（`vcode:cd:{scene}:{email}`），验证码 TTL 5min（`vcode:{scene}:{email}`）
  - 依赖 `CACHE_MANAGER`（全局 CacheModule）和 `MailService`

- **AuthService 实桩替换**
  - `sendVerificationCode` — 调用 VerificationCodeService.send
  - `verifyEmail` — 调用 VerificationCodeService.verify + UserService.updateByEmail 标记邮箱已验证
  - `login` — 支持 `dto.code` 验证码登录（可选，与密码登录互斥）

- **UserService 新增**
  - `updateByEmail(email, data)` — 按邮箱更新用户（用于 verifyEmail 场景）

- **AuthModule** — 注册 `VerificationCodeService` 为 provider

- **AuthController** — `sendVerificationCode` 和 `verifyEmail` 方法改为 `async`

### Changed — ResultCode 枚举

- `api-envelope.ts` 新增：
  - `VERIFICATION_CODE_INVALID = 400_100` — 验证码错误/过期
  - `VERIFICATION_CODE_COOLDOWN = 400_101` — 发送过于频繁

---

## 2026-05-27 (Auth Step 1 — Controller 层)

### Added — AuthController + AuthModule

- **AuthController** (`src/auth/auth.controller.ts`)
  - 13 个路由，严格对齐 `docs/auth-api-mock.md`：
    - `POST /auth/register` — 注册 → 201
    - `POST /auth/login` — 密码登录
    - `POST /auth/logout` — 登出（需认证）
    - `POST /auth/refresh` — 刷新 Token（无需认证）
    - `POST /auth/send-verification-code` — 发送验证码（桩）
    - `POST /auth/verify-email` — 验证邮箱（桩）
    - `POST /auth/forgot-password` — 忘记密码（桩）
    - `POST /auth/reset-password` — 重置密码（桩）
    - `GET /auth/me` — 获取当前用户（需认证）
    - `PATCH /auth/me` — 更新当前用户（需认证）
    - `POST /auth/me/password` — 修改密码（需认证）
    - `POST /auth/me/email` — 修改邮箱（需认证）
    - `DELETE /auth/me` — 注销账号（需认证）
  - 受保护路由使用 `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` 提取用户
  - `/auth/refresh` 不加 Guard（accessToken 可能已过期）
  - 响应格式严格遵循 `successEnvelope`（`{ code: 0, message: "", data }`）

- **AuthModule** (`src/auth/auth.module.ts`)
  - 导入 `UserModule`、`PassportModule`、`JwtModule`
  - 注册 `AuthService`、`JwtAccessStrategy`、`AuthController`
  - 导出 `AuthService` 供其他模块使用

- **app.module.ts** — 注册 `AuthModule`

---

## 2026-05-27 (Git 提交约束)

### Added — Git 提交规范工具链

- **commitlint** — `commitlint.config.mjs`
  - 基于 `@commitlint/config-conventional`
  - 类型枚举：`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  - 允许中文 subject，header 最大 120 字符

- **husky** — Git hooks 管理
  - `.husky/pre-commit` — 运行 `lint-staged`（暂存文件 lint + prettier）
  - `.husky/commit-msg` — 运行 `commitlint`（校验 commit message 格式）

- **lint-staged** — 暂存文件检查
  - `*.ts` → eslint --fix + prettier --write
  - `*.{json,md,yml,yaml}` → prettier --write

- **依赖新增**
  - `@commitlint/cli@^21.0.1`, `@commitlint/config-conventional@^21.0.1`
  - `husky@^9.1.7`, `lint-staged@^17.0.5`

- **脚本更新** — `package.json` 新增 `"prepare": "husky"`
- **ESLint 更新** — `commitlint.config.mjs` 加入 ignores

---

## 2026-05-27 (Auth Step 1 — 核心认证)

### Added — Auth 核心认证模块 (Step 1)

- **JWT 配置** (`src/config/jwt.config.ts`)
  - `registerAs(ConfigKey.Jwt, ...)`，支持 `accessSecret` / `refreshSecret` / `accessTtl` / `refreshTtl`
  - `ConfigKey` 新增 `Jwt` 枚举值

- **User 模块** (`src/user/`)
  - `UserService` — `create`, `findByEmail`, `findById`, `update` (CRUD)
  - `UserModule` — `@Global()`，导出 `UserService`

- **DTO 层** (`src/auth/dto/`)
  - 14 个 class-validator DTO：`RegisterDto`, `LoginDto`, `RefreshDto`, `LogoutDto`, `UpdateMeDto`, `ChangePasswordDto`, `ChangeEmailDto`, `DeleteAccountDto`, `SendVerificationCodeDto`, `VerifyEmailDto`, `ForgotPasswordDto`, `ResetPasswordDto`
  - 统一导出 `src/auth/dto/index.ts`

- **AuthService** (`src/auth/auth.service.ts`)
  - `register` — 邮箱唯一性检查 + argon2id 密码哈希 + JWT 签发
  - `login` — 密码验证 + 登录频率限制（内存，待迁 Redis）
  - `refresh` — Refresh Token 旋转（旧 token 删除 + 新 token 签发）
  - `logout` / `logoutAll` — 单设备 / 全设备登出
  - `getMe` / `updateMe` — Profile 读写
  - `changePassword` / `changeEmail` / `deleteAccount` — 账号管理
  - `sendVerificationCode` / `verifyEmail` / `forgotPassword` / `resetPassword` — 邮件验证 & 密码重置（桩实现）
  - Argon2id 参数：memoryCost 19456, timeCost 2, parallelism 1（OWASP 2024 推荐）
  - Refresh Token 存储原始值（高熵随机字符串，HTTPS 传输保障）

- **JWT Strategy + Guard** (`src/auth/strategies/`, `src/auth/guards/`)
  - `JwtAccessStrategy` — Passport Strategy，`HS512` 算法，从 `Authorization: Bearer` 提取 token
  - `JwtAuthGuard` — `@UseGuards(JwtAuthGuard)` 触发验证

- **CurrentUser 装饰器** (`src/auth/decorators/current-user.decorator.ts`)
  - `@CurrentUser()` 提取 `request.user` (UserPayload: `{ sub, email }`)
  - `@CurrentUser('sub')` 提取单个字段

- **依赖新增**
  - `passport@^0.7.0`, `passport-jwt@^4.0.1`, `@nestjs/passport@^11.0.0`, `@nestjs/jwt@^11.0.0`
  - `@types/passport-jwt@^4.0.1`

### Added — Auth 基础设施 (Step 0)

- **Prisma ORM 集成**
  - `Lumos/prisma/schema.prisma` — User + RefreshToken 模型（UUID v4 主键，argon2 密码哈希）
  - `Lumos/prisma.config.ts` — Prisma v7 配置，输出到 `Lucent/src/generated/prisma/`
  - `src/prisma/prisma.service.ts` — `OnModuleInit` 自动连接
  - `src/prisma/prisma.module.ts` — `@Global()`
  - 依赖：`@prisma/client@^7.8.0`, `prisma@^7.8.0`, `pg@^8.21.0`

- **Mail 模块**
  - `src/mail/mail.service.ts` — `send()` / `sendVerificationCode()`，双模式：
    - `MAIL_DRIVER=log`：Winston Logger 打印（开发用）
    - `MAIL_DRIVER=smtp`：nodemailer 真实发送
  - `src/mail/mail.module.ts` — `@Global()`
  - `src/config/mail.config.ts` — `registerAs(ConfigKey.Mail, ...)`
  - 依赖：`nodemailer@^8.0.9`

- **Cache 模块 (Redis)**
  - `src/config/cache.config.ts` — `CacheConfigService`，从 `REDIS_URL` 解析连接参数
  - 使用 `cache-manager-ioredis-yet`，无 Redis 时 fallback 内存缓存
  - `app.module.ts` 中通过 `CacheModule.registerAsync` 全局注册
  - 依赖：`@nestjs/cache-manager@^3.1.2`, `cache-manager@^7.2.8`, `cache-manager-ioredis-yet@^2.1.2`

- **邮件环境变量** — `EnvKey` 新增 `MAIL_DRIVER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`

- **ConfigKey 新增** — `Mail` namespace

### Changed — 环境变量架构重构

- **`.env` 文件层级分离**：
  - `.env` — 各环境公有默认值（HOST, PORT, CORS_ORIGIN, JWT TTL, 邮件默认值, LOG_LEVEL）
  - `.env.development` — 开发环境专属（NODE_ENV, 数据库, JWT dev secret, MAIL_DRIVER=log）
  - `.env.production` — 生产环境专属（NODE_ENV, 数据库, JWT prod secret, MAIL_DRIVER=smtp）
  - `.env.example` / `.env.development.example` / `.env.production.example` — 同步结构
  - 加载链：`.env.{NODE_ENV}` → `.env`（后者为 fallback）

- **`app.module.ts`** — 注册 `PrismaModule`, `MailModule`, `CacheModule`

- **`environment.validation.ts`** — Joi schema 新增 6 个 mail key 校验

### Changed — 密码哈希方案

- `bcrypt` → `argon2@^0.44.0`（更强抗 GPU/ASIC 攻击，自带 TS 类型）

### Pending

- **Step 0.6 数据库迁移** — 等待 PostgreSQL 启动后执行 `prisma migrate dev --name init`

---

## 2026-05-26

### Added

- **Winston 日志集成** — `src/common/logger/`
  - `logger.config.ts` — 按 NODE_ENV 切换格式（development 彩色 / production JSON）
  - `logger.module.ts` — `@Global()` 模块，按 `LOG_LEVEL` 配置日志级别
  - `main.ts` — `app.useLogger()` 替换 NestJS 默认 Logger
  - `setup-app.ts` — HTTP 请求日志中间件（method / url / statusCode / duration）
  - 依赖：`winston` + `nest-winston`

- **环境变量枚举** — `src/config/`
  - `env-keys.enum.ts` — `EnvKey` 枚举，14 个环境变量 key，消除 `process.env['NODE_ENV']` 等魔法字符串
  - `config-keys.enum.ts` — `ConfigKey` 枚举，NestJS namespace key

- **Joi 环境校验** — `src/config/environment.validation.ts`
  - 从 `class-validator` / `class-transformer` 迁移到 `joi`
  - 链式 API：`.default()` / `.valid()` / `.uri({ scheme: /^postgres/ })`
  - 新增 `LOG_LEVEL` 校验（debug / info / warn / error）
  - 新增 `DATABASE_URL` / `REDIS_URL` / `AI_BASE_URL` 的 URI scheme 校验
  - 依赖：`joi`

- **环境变量文件**
  - `.env.development` — 开发环境默认值（含 JWT dev secret）
  - `.env.production` — 生产环境模板（占位符，由部署时填充）
  - `.env.example` — 补充 `LOG_LEVEL=debug`
  - `.env.development.example` — 补充 `LOG_LEVEL=debug`
  - `.env.production.example` — 补充 `LOG_LEVEL=info`

### Changed

- `config/app.config.ts` — `registerAs('app', ...)` → `registerAs(ConfigKey.App, ...)` + 使用 `EnvKey`
- `main.ts` — `'app.host'` / `'app.port'` → `` `${ConfigKey.App}.host` ``
- `setup-app.ts` — `'app.corsOrigin'` → `` `${ConfigKey.App}.corsOrigin` ``
- `environment.validation.ts` — 类属性改用 `[EnvKey.XXX]` 计算属性名；`NodeEnvironment` 导出
- `app.module.ts` — 注册 `LoggerModule`
- `logger.module.ts` — `process.env['NODE_ENV']` → `process.env[EnvKey.NODE_ENV]`

### Fixed

- `tsconfig.json` — 移除 `baseUrl` 和 `ignoreDeprecations`（NestJS SWC builder 不兼容）

---

### Changed

- **API 响应码：字符串 → 数字** — `api-envelope.ts` `ErrorCode` 枚举
  - `0` 成功 / `400001` 参数错误 / `401001` 未登录 / `401002` Token 过期 / `404001` 未找到 / `5xxxxx` 服务端异常
  - Flutter `LucentApiClient.code` 改为 `int`，`GlobalConstants.LUCENT_SUCCESS_CODE` = `0`
  - `docs/api-contract.md` 同步

### Fixed

- `tsconfig.json` — 移除 `baseUrl` + `ignoreDeprecations`（NestJS SWC builder 不兼容）

---

## 2026-05-26（基线）

- NestJS 11 项目初始化
- API envelope：`{ code, message, data, meta? }`
- 异常过滤器：`ApiExceptionFilter`（HTTP status → error envelope）
- `X-Request-Id` 中间件
- `GET /api/v1/health` 端点 + 单元测试 + E2E 测试
- `@nestjs/config` + `environment.validation.ts`（class-validator 版本）
- URI 版本控制：`/api/v1`
- 文档：`docs/api-contract.md` / `docs/environment.md` / `docs/migration-roadmap.md`

# 2026-06-01

## chore(deploy): add full GitHub Actions CI/CD pipeline

- Expanded `.github/workflows/deploy-server.yml` into a full pipeline:
  - CI on `push` / `pull_request`
  - build + push immutable Docker images on `main`
  - SSH deploy to the server after CI passes
- CI now runs:
  - Prisma generate
  - Prisma migrate deploy against the test database
  - `pnpm lint:check`
  - `pnpm build`
  - unit tests
  - e2e tests
- `pnpm lint` / `pnpm lint:check` now ignore Prisma generated sources under `src/generated/**` so CI does not fail on generated artifacts.
- Production deploy now:
  - pulls the exact image tag built from the commit
  - mirrors PostgreSQL / Redis runtime images into the target registry
  - syncs deployment files over SSH instead of running `git pull` on the server
  - works even when the server cannot reach GitHub directly
  - keeps PostgreSQL / Redis data volumes on the server
  - recreates containers from the synced compose file
  - waits for Docker health checks
  - rolls back the `app` image if health checks fail
- `docker-compose.yml` now consumes `LUCENT_IMAGE`, `POSTGRES_IMAGE`, and `REDIS_IMAGE`, and exposes a Docker health check for Lucent.
- Added `scripts/deploy/deploy-server.sh` for repeatable server-side deployment orchestration.
- Added `.deploy-image.env` to `.gitignore`.
- Updated `.env.production.example` to match the default single-host Docker deployment topology.
- Updated `README.md` and `docs/environment.md` with registry, secrets, and bootstrap instructions.
- Added `docs/tencent-cloud-cicd.md` as the Tencent Cloud CVM + TCR operator runbook for the current pipeline.

## chore(docker): bump local postgres and redis major versions

- `docker-compose.dev.yml`
  - development PostgreSQL image: `postgres:16-alpine` -> `postgres:18-alpine`
  - test PostgreSQL image: `postgres:16-alpine` -> `postgres:18-alpine`
  - Redis image: `redis:7-alpine` -> `redis:8-alpine`
  - PostgreSQL volume mount path: `/var/lib/postgresql/data` -> `/var/lib/postgresql`
- `docker-compose.yml`
  - PostgreSQL image: `postgres:16-alpine` -> `postgres:18-alpine`
  - Redis image: `redis:7-alpine` -> `redis:8-alpine`
  - PostgreSQL volume mount path: `/var/lib/postgresql/data` -> `/var/lib/postgresql`
