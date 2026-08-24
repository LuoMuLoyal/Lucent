---
status: active
owner: backend
quadrant: plan
updated: 2026-08-24
---

# Lucent 配置迁移计划：.env → .env + YAML 共存

> 前身：`env-yaml-evaluation-research.md`（调研报告，2026-08-22）。
> 本文件在原评估结论基础上改写为实施计划，仅聚焦配置格式迁移，不涉及部署和监控栈变更。

## 目标

非敏感运行时配置从扁平 `.env` 迁移到嵌套 YAML，敏感变量保留在 `.env`，两者共存。

## 不变的技术约束

- **Node.js 原生 dotenv 只处理 `.env` 键值文件**：YAML 必须由应用或额外库解析。
- **NestJS 支持自定义配置工厂读取 YAML**：需配置 `compilerOptions.assets` 复制 YAML 到 `dist`。
- **Prisma 官方链路是 dotenv / `process.env`**：`prisma.config.ts` 保持独立加载 `.env`，不依赖 Nest 或 YAML。
- **当前配置工厂直接读取 `process.env`**：必须在配置工厂执行前合并 YAML，或让工厂改为读取 Nest 配置对象。

## 当前仓库约束

- `prisma.config.ts` 遍历 `getDotenvLoadOrder()`，用 `dotenv.config({ path, override: true })` 加载 `.env.<NODE_ENV>` 和 `.env.<NODE_ENV>.local`，然后读取 `process.env['DATABASE_URL']`。
- `src/config/env/env-file-paths.ts` 为 Nest 运行时返回 `.env.<NODE_ENV>.local`、`.env.<NODE_ENV>`；为 Prisma / 脚本返回 `.env.<NODE_ENV>`、`.env.<NODE_ENV>.local`。
- `src/app.module.ts` 使用 `ConfigModule.forRoot({ envFilePath, load: [...], validate })`。已有配置工厂直接读取 `process.env`。
- `package.json` 当前有 `@nestjs/config`、`dotenv`、`prisma` 依赖，没有 `yaml` 或 `js-yaml` 依赖。
- `src/main.ts` 在 Nest 应用创建前读取 `TRUST_PROXY`；`src/tracing.ts` 在 Nest bootstrap 前决定是否启用 OTel。这些值不能只通过 Nest `load` 配置工厂提供。
- `Dockerfile` 生产镜像只显式复制 `dist`、Prisma 文件和 i18n 资产；新增 YAML 文件必须显式 COPY 或配置 Nest assets。
- `src/config/env/environment.validation.ts` 中 Zod schema 已有大量 `.default()` 调用，这些代码级默认值是迁移期间的安全网。
- `src/config/constants.ts` 集中了所有默认值常量和上限值，Zod schema 引用它们。

## YAML 文件存放位置：`Lucent/config/`

理由：

1. `src/config/` 是配置加载代码，`config/` 是配置数据——职责分离清晰。
2. 项目根目录已有 `nest-cli.json`、`tsconfig.json` 等构建配置文件，再加 YAML 容易混淆。
3. Dockerfile 中 `COPY config/ ./config/` 一行搞定；Nest CLI assets 配置 `"config/**/*.yaml"` 精确匹配。

## 默认值策略：不需要 `.env.defaults`

默认值通过两层提供：

1. **`config/default.yaml`**：非敏感配置的显式默认值，入库可审查，嵌套结构可读。
2. **Zod schema `.default()`**：代码级安全网，确保即使 YAML 缺失某键也能工作。

不创建 `.env.defaults` 的理由：默认值出现在两个文件中容易出现不一致；扁平键值无法表达嵌套——与迁移到 YAML 的初衷矛盾。

## 配置分类与归属

### 保留在 `.env` / 环境变量

- `DATABASE_URL`：Prisma CLI 直接需要。
- 数据库密码、Redis 密码/URL、对象存储 secret、邮件密码、OAuth secret、推送密钥、AI API key。
- JWT secret、Admin 密码、Admin cookie secret、Better Auth secret。
- `METRICS_USER` / `METRICS_PASSWORD`：scrape 认证。
- `TESTING_SHARED_SECRET`：测试支持。

### 迁移到 `config/` YAML

- `HOST`、`PORT`、`CORS_ORIGIN`、`PUBLIC_BASE_URL`：非机密运行参数。
- `LOG_LEVEL`、`LOG_FORMAT`、`SLOW_REQUEST_THRESHOLD_MS`、`SLOW_QUERY_THRESHOLD_MS`：日志参数。
- 队列并发、缓存 TTL、上传大小、模糊匹配阈值、餐食分析参数、验证码参数等数值参数。
- AI `BASE_URL` / `MODEL`（不含 API key）、OAuth redirect URI、COS/S3 endpoint / bucket / region。
- `MAIL_DRIVER`、`MAIL_HOST`、`MAIL_PORT`、`MAIL_FROM`：邮件非敏感配置。
- `STORAGE_PROVIDER`、`JPUSH_APNS_PRODUCTION`、`JPUSH_API_BASE_URL`：功能开关和公共 endpoint。
- `SUPPORT_EMAIL`、`MIN_CLIENT_VERSION`、`LATEST_VERSION`、`DOWNLOAD_URL`：客户端运营配置。
- `METRICS_ENABLED`：功能开关。

### 保留为环境变量（启动选择器）

以下变量在 Nest / OTel / Prisma 启动前读取，不能放入 YAML：

- `NODE_ENV`：决定加载哪个 `.env.<NODE_ENV>` 和 `config/<NODE_ENV>.yaml`。
- `OTEL_ENABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`：`src/tracing.ts` 在 Nest bootstrap 前读取。
- `TRUST_PROXY`：`src/main.ts` 在 Nest 应用创建前读取。
- `OPENAPI_EXPORT_SKIP_DB_CONNECT`：OpenAPI 导出脚本在 Nest 启动前使用。

## 目标架构

### 文件布局

```text
Lucent/
├── config/
│   ├── default.yaml              # 入库，非敏感默认值
│   ├── development.yaml          # 入库，开发环境普通参数覆盖
│   ├── test.yaml                 # 入库，测试环境普通参数覆盖
│   ├── production.yaml           # 入库，生产环境普通参数覆盖
│   └── *.local.yaml              # gitignored，本机覆盖
├── .env.development              # gitignored，开发环境敏感值
├── .env.development.example      # 入库，开发环境模板
├── .env.production               # gitignored，生产环境敏感值
├── .env.production.example       # 入库，生产环境模板
├── .env.test                     # gitignored，测试环境敏感值
├── .env.test.example             # 入库，测试环境模板
└── src/config/                   # 配置加载代码（不变）
```

### 配置优先级

```text
环境变量（运行时注入） > .env.<env>.local > .env.<env>（仅敏感/启动变量）
> config/<env>.local.yaml > config/<env>.yaml > config/default.yaml > Zod schema .default()
```

`.env` 与 YAML 应尽量没有同名键。若同名键出现，启动时应报冲突警告，而不是静默覆盖。

## 实施步骤

### Phase 1：YAML loader 与基础架构

1. **引入 YAML 解析依赖**：`pnpm add yaml`（选择 `yaml` 库而非 `js-yaml`，API 更现代）。

2. **创建 `config/` 目录和 `default.yaml`**：将 `src/config/constants.ts` 中的默认值和 `.env.*.example` 中的非敏感默认值迁移到嵌套 YAML 结构。

   YAML 命名空间设计（示例）：

   ```yaml
   app:
     host: 0.0.0.0
     port: 3000
     corsOrigin: ''
     publicBaseUrl: 'http://localhost:3000'
   log:
     level: debug
     format: pretty
     slowRequestThresholdMs: 2000
     slowQueryThresholdMs: 500
   mail:
     driver: log
     host: 'smtp.example.com'
     port: 587
     from: 'noreply@example.com'
     queue:
       maxAttempts: 3
       backoffDelayMs: 5000
       workerConcurrency: 3
   fuzzy:
     acceptScore: 0.7
     minLead: 0.1
     queryPrefixLength: 1
   meal:
     defaultPortionGrams: 100
   ```

3. **创建环境特定 YAML**：`config/development.yaml`、`config/test.yaml`、`config/production.yaml`，只包含与环境不同的覆盖值。

4. **实现 YAML loader 模块**：在 `src/config/` 下创建一个不依赖 Nest 的纯配置读取模块：
   - 按 `NODE_ENV` 选择 `config/default.yaml` + `config/<NODE_ENV>.yaml` + `config/<NODE_ENV>.local.yaml`。
   - 使用 `yaml` 库解析。
   - 合并三个层次的 YAML（deep merge）。
   - 对 YAML 做启动期 schema 校验和类型转换。
   - 合并敏感 `.env` / `process.env` 值。
   - 输出一个嵌套配置对象供 Nest `ConfigModule` 使用。

5. **修改 Nest `ConfigModule`**：`app.module.ts` 的 `ConfigModule.forRoot()` 改为加载 YAML loader 产出的嵌套配置。`ignoreEnvFile: false` 仍保留，用于加载敏感 `.env` 文件。

6. **修改配置工厂**：`src/config/app.config.ts`、`src/config/services/*.config.ts` 从直接读取 `process.env` 改为读取 Nest `ConfigService` 的嵌套配置对象。

7. **更新 Zod schema**：`environment.validation.ts` 中的 `validate` 函数改为接收合并后的配置对象（YAML + env），而非只接收 `process.env`。保留 `.default()` 作为安全网。

8. **配置 Nest CLI assets**：在 `nest-cli.json` 的 `compilerOptions.assets` 中添加 `"config/**/*.yaml"`。

9. **更新 Dockerfile**：在 production stage 添加 `COPY config/ ./config/`。

### Phase 2：`.env` 精简

1. **精简 `.env.*.example` 文件**：移除已迁移到 YAML 的非敏感变量，只保留敏感变量和启动选择器。

2. **更新 `env-keys.enum.ts`**：保留所有枚举值（兼容期需要），但标注哪些已迁移到 YAML。

3. **更新 `env-file-paths.ts`**：Nest 和 Prisma 的 `.env` 文件路径逻辑不变，但 `.env` 文件内容变薄。

### Phase 3：清理与验证

1. **移除已迁移的变量**：从 `env-keys.enum.ts`、`environment.validation.ts`、`.env.*.example` 中删除已迁移到 YAML 的非敏感变量。

2. **更新文档**：
   - `docs/01-reference/environment.md`：更新配置来源说明。
   - 当日迁移日志。

3. **全量验证**：执行下方验证矩阵。

## 验证矩阵

### YAML 加载与优先级

- [ ] 仅提供 `config/default.yaml` + 必需敏感 `.env`：Nest 启动成功，普通配置类型正确，Prisma 连接成功。
- [ ] `config/<env>.yaml` 覆盖 `config/default.yaml` 中的值：结果符合预期。
- [ ] `config/<env>.local.yaml` 覆盖 `config/<env>.yaml` 中的值：结果符合预期。
- [ ] 普通 YAML 缺失、字段类型错误：启动失败且错误指向明确。
- [ ] 必填敏感变量缺失：启动失败且错误指向明确。
- [ ] 环境变量覆盖 YAML 同名配置：环境变量注入值优先。
- [ ] `.env` 与 YAML 同名键同时存在：启动时报冲突警告。

### Prisma 独立性

- [ ] `NODE_ENV=test` 下运行 `prisma migrate deploy / generate / validate`：Prisma 仍加载正确的 `.env.test*`，不依赖应用 YAML。
- [ ] `prisma.config.ts` 不 import Nest 或 YAML loader。

### 构建与镜像

- [ ] `pnpm build` 后 `dist/config/` 目录存在且包含所有 YAML 文件。
- [ ] 从 `dist` 启动（模拟生产镜像）：YAML 资产路径正确，应用正常启动。
- [ ] Dockerfile production stage 中 `COPY config/ ./config/` 生效。

## 风险与回退

- **YAML loader bug 导致启动失败**：回退方式是 `ConfigModule` 回到直接读取 `process.env`，YAML 文件不影响 `.env` 中的值。迁移期间 `.env` 仍保留所有变量作为安全网。
