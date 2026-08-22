---
status: active
owner: backend
quadrant: reference
updated: 2026-08-22
---

# Lucent 环境变量迁移到 YAML 的评估报告

> 调研范围：普通环境变量迁移到 YAML；敏感变量继续放在 `.env`；Prisma CLI / Prisma Client 继续读取 `.env`。本文件只使用 Prisma、Node.js、NestJS、YAML 库、Docker Compose、Kubernetes 的官方文档或官方源码作为外部依据。
>
> 访问日期：2026-08-22（Asia/Shanghai）。

## 结论摘要

**结论：值得迁移，但应作为一次配置加载链重构，不能只把 `.env` 改名为 YAML。**

推荐的边界是：

1. `DATABASE_URL` 以及密码、token、secret、API key 等继续由 `.env` / 运行时 Secret 提供；不要把 `DATABASE_URL` 放进普通 YAML。
2. 普通运行时配置可以进入 YAML，由 Nest `ConfigModule` 的自定义配置加载器读取。Nest 官方文档明确给出了 YAML 文件、`js-yaml` 解析和 `load` 配置的做法。
3. Prisma 不会因为 Nest 读取了 YAML 就自动读取 YAML。Lucent 当前的 `prisma.config.ts` 已经显式用 `dotenv` 加载按 `NODE_ENV` 选择的 `.env` 文件，并只从 `process.env` 读取 `DATABASE_URL`；只要这个变量继续在 `.env` 或运行时环境中，Prisma CLI 的数据库配置链可以保持不变。
4. 当前 Lucent 的配置工厂大多直接读取 `process.env`。因此，仅把 YAML 加到 Nest 的 `ConfigService` 而不调整现有配置读取链，不能保证现有配置工厂看到 YAML 值。实现时必须在配置工厂执行前合并 YAML，或让配置工厂改为读取 Nest 的自定义配置对象；这是本项目的实现约束，不是官方文档自动保证的行为。
5. Docker Compose 和 Kubernetes 都能分别承载普通配置与敏感配置，但它们的配置注入边界不同：Compose 的 `env_file` 是 dotenv 风格文件，Kubernetes 则原生提供非机密的 ConfigMap 和机密的 Secret。部署时应继续让应用最终获得 `process.env`，或明确挂载并读取应用 YAML 文件。

上述第 1、2、3、5 点有官方来源；第 4 点是结合官方行为与 Lucent 当前代码得出的项目判断。

## 评估结果

| 维度               | 结论                 | 判断依据                                                                                                               |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 技术可行性         | 高                   | NestJS 官方支持通过自定义配置工厂读取 YAML；Prisma 只要求 `DATABASE_URL` 最终在环境变量中可用。                        |
| Prisma 兼容性      | 高，前提是隔离加载链 | 保留 `DATABASE_URL` 在 `.env` / Secret / `process.env`，不要让 Prisma CLI 依赖 Nest bootstrap 或 YAML。                |
| 对配置可读性的改善 | 中到高               | 只有把 YAML 作为嵌套、类型化配置对象使用时收益明显；读取后全部 flatten 到 `process.env` 只能得到有限的文件组织收益。   |
| 迁移复杂度         | 中到高               | 当前配置被 Nest、OTel 预加载、Prisma CLI、导入脚本、部署脚本和 Docker 镜像分别使用。                                   |
| 安全收益           | 低到中               | 把 Secret 从普通配置中分离能减少误提交和误展示，但 `.env` 本身不是 Secret Manager；Docker 官方建议敏感值使用 secrets。 |
| 当前建议           | 分阶段实施           | 先建立统一的 YAML + Secret loader 和优先级测试，再迁移普通变量；不要在本次评估阶段直接改生产部署。                     |

### 对用户预期的修正

“`.env` 只保存敏感信息”对于应用运行时可以作为目标，但对当前整个 Lucent 部署系统并不完全成立：生产 `/opt/lucent/.env` 还承载
`COMPOSE_PROJECT_NAME`、`LUCENT_IMAGE` 等 Compose / deploy 状态，`deploy.ts` 会快照并修改其中的镜像行，`render-configs.sh` 也从其中读取监控配置。因此，若要做到严格分离，需要另行拆出 `compose.env` / `deploy.env` 与应用 Secret 文件，不能只改 Nest 配置。

另外，`NODE_ENV`、`OTEL_ENABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`、`TRUST_PROXY` 以及 OpenAPI/Redis 跳过开关存在启动前读取路径。它们不是敏感信息，但如果没有一个独立的预启动 YAML loader，就不应强行迁出环境变量。更准确的目标是：

> 普通应用默认配置进入 YAML；Secret 和平台注入值进入环境；少量启动选择器保留为环境变量；所有来源由一个明确的 loader 合并并校验。

## Lucent 当前约束（本地一手资料）

以下是仓库现状，不是外部资料推断：

- `prisma.config.ts` 遍历 `getDotenvLoadOrder()`，用 `dotenv.config({ path, override: true })` 加载 `.env.<NODE_ENV>` 和 `.env.<NODE_ENV>.local`，然后读取 `process.env['DATABASE_URL']`，作为 Prisma Config 的 `datasource.url`。
- `src/config/env/env-file-paths.ts` 为 Nest 运行时返回 `.env.<NODE_ENV>.local`、`.env.<NODE_ENV>`，本地文件优先；为 Prisma / 脚本返回 `.env.<NODE_ENV>`、`.env.<NODE_ENV>.local`，后者在 `override: true` 下覆盖前者。
- `src/app.module.ts` 使用 `ConfigModule.forRoot({ envFilePath, load: [...], validate })`。已有配置工厂（例如 `src/config/app.config.ts`、`src/config/services/*.config.ts`）直接读取 `process.env`。
- `package.json` 当前有 `@nestjs/config`、`dotenv`、`prisma` 依赖，没有看到 `yaml` 或 `js-yaml` 依赖。引入 YAML 解析器会是新增依赖和构建资产配置，但本调研不引入依赖。
- 当前 Prisma 配置文件只消费 `DATABASE_URL`；因此，把普通应用变量迁移到 YAML，不会直接影响 Prisma CLI 的 datasource URL，前提是 `DATABASE_URL` 的供应方式保持可用。
- `src/main.ts` 在 Nest 应用创建前读取 `TRUST_PROXY`；`src/tracing.ts` 在 Nest bootstrap 前加载环境并决定是否启用 OTel；因此这些值不能只通过普通的 Nest `load` 配置工厂提供。
- `Dockerfile` 生产镜像只显式复制 `dist`、Prisma 文件和 i18n 资产；新增 YAML 文件必须显式复制或配置 Nest assets，否则源码环境能启动、构建后的镜像可能找不到配置文件。
- `deploy/compose.yml`、`deploy/deploy.ts` 和 `deploy/render-configs.sh` 把生产 `.env` 同时当作 Compose 插值源、容器 `env_file`、部署状态文件和监控渲染输入；这是应用配置之外的另一条边界。

## 官方事实与来源记录

### 1. Node.js 的原生 dotenv 能力针对 `.env` 键值文件，不是 YAML

- URL：[Node.js Environment Variables](https://nodejs.org/api/environment_variables.html)
- 页面标题：`Environment Variables | Node.js v26.7.0 Documentation`
- 访问日期：2026-08-22
- 相关章节：`DotEnv` → `.env files`、`Variable Names`、`Variable Values`、`CLI Options`、`Programmatic APIs`
- 原文要点：Node.js 将 `.env` 定义为变量名、等号和变量值组成的键值对文件；变量值在 Node.js 中都按文本处理。官方还说明 `--env-file`、`--env-file-if-exists` 和 `process.loadEnvFile()` 会把 `.env` 内容填入 `process.env`。
- 对本方案的含义：YAML 不能直接作为 Node 原生 `--env-file` / `process.loadEnvFile()` 的替代输入。若使用 YAML，必须由应用或额外库解析，再决定放入 Nest 自定义配置对象或 `process.env`。

### 2. NestJS 支持 dotenv、多个 env 文件、自定义配置对象和 YAML

- URL：[NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- 页面标题：`Configuration`
- 访问日期：2026-08-22
- 相关章节：`Getting started`、`Custom env file path`、`Disable env variables loading`、`Custom configuration files`、YAML configuration 示例、`Schema validation`
- 原文要点：`ConfigModule.forRoot()` 会读取并解析 `.env`，将其与 `process.env` 合并后通过 `ConfigService` 提供；运行时 `process.env` 中已有的值优先于 `.env`。`envFilePath` 可接受多个路径，多个文件冲突时第一个路径优先；`ignoreEnvFile: true` 可关闭 `.env` 读取。
- 原文要点：自定义配置文件由工厂函数返回任意嵌套的普通 JavaScript 对象，并通过 `load: [configuration]` 加载。官方的 YAML 示例使用 `js-yaml` 的 `yaml.load(readFileSync(...))`；Nest CLI 不会自动把非 TypeScript 的 YAML 资产复制到 `dist`，需要配置 `compilerOptions.assets`。
- 原文要点：自定义配置文件不会自动校验，即使使用 `validationSchema`；需要在工厂函数中自行处理验证或转换。环境变量则可以使用 Joi 或自定义 `validate()` 进行启动期校验。
- 对本方案的含义：Nest 层面有官方支持的 YAML 接入点。YAML 的嵌套结构适合按 `app`、`http`、`mail` 等命名空间组织普通配置；同时必须补上 YAML 文件的构建/打包和校验策略。

### 3. 官方 YAML 库提供字符串解析为 JavaScript 值的 API

- URL：[YAML official documentation](https://eemeli.org/yaml/)
- 页面标题：`YAML`
- 访问日期：2026-08-22
- 相关章节：`Parse & Stringify`、`YAML.parse`、`YAML.stringify`、`Documents` → `parseDocument`
- 原文要点：该库文档提供 `parse(str)`、`stringify(value)`，以及需要保留文档结构时使用的 `parseDocument(str)`；安装方式为 `npm install yaml`。
- 对本方案的含义：如果 Lucent 选择 `yaml` 库而不是 Nest 示例中的 `js-yaml`，它具备读取应用 YAML 所需的官方 API；解析结果可能是数字、布尔值、数组或对象，不应未经边界转换就当作 dotenv 的字符串值使用。库的选择、版本和安全策略仍需后续实现时固定。

### 4. Prisma ORM 会从系统环境和 `.env` 获取环境变量；Prisma Config 官方示例显式加载 dotenv

- URL：[Managing Prisma ORM environment variables and settings](https://www.prisma.io/docs/orm/more/development-environment/environment-variables)
- 页面标题：`Managing Prisma ORM environment variables and settings | Prisma Documentation`
- 访问日期：2026-08-22
- 相关章节：`How Prisma ORM can use environment variables`、`Using an .env file`、Prisma CLI 的 `.env` 查找位置表
- 原文要点：Prisma ORM 读取系统环境变量；使用 Prisma CLI 或 Prisma Client 时，`.env` 文件内容会被加入 `process.env`，供 Prisma 使用。文档列出 CLI 查找 `.env` 的项目根目录、schema 所在目录、package.json 中 schema 所在目录和 `./prisma` 目录等位置。
- 原文要点：如果多个候选 `.env` 文件定义了冲突变量，Prisma CLI 会报冲突错误；文档以 `.env` 和 `prisma/.env` 中重复定义 `DATABASE_URL` 为例，并建议集中到一个文件。
- 对本方案的含义：Prisma 官方链路是 dotenv / `process.env`，不是任意 YAML。保留 `DATABASE_URL` 在 `.env` 或运行时环境中，可以让 Prisma 继续工作；普通应用 YAML 不需要进入 Prisma CLI 的配置链。

- URL：[Reference documentation for the prisma config file](https://www.prisma.io/docs/orm/reference/prisma-config-reference)
- 页面标题：`Reference documentation for the prisma config file | Prisma Documentation`
- 访问日期：2026-08-22
- 相关章节：`Config API` 开头示例、`Type-safe environment variables`、`Handling optional environment variables`
- 原文要点：官方示例在 `prisma.config.ts` 顶部写 `import "dotenv/config"`，再用 `defineConfig()` 和 `env("DATABASE_URL")` 配置 datasource。`env()` 在变量缺失时抛错；每个 Prisma CLI 命令都会加载 `prisma.config.ts`，即使某个命令实际不需要 datasource URL 也可能因此失败。
- 对本方案的含义：Lucent 当前自定义 `prisma.config.ts` 显式加载 dotenv 的做法符合官方配置模型。不要让 Prisma 依赖 Nest 的 YAML 加载时机；Prisma 配置应保持独立、可由 CLI 直接加载，并继续以 `.env` / `process.env` 提供 `DATABASE_URL`。

### 5. Docker Compose 可以注入普通环境变量，但官方不建议用环境变量传敏感信息

- URL：[Set environment variables within your container's environment](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- 页面标题：`Set environment variables within your container's environment | Docker Docs`
- 访问日期：2026-08-22
- 相关章节：`Use the environment attribute`、`Use the env_file attribute`
- 原文要点：Compose 只有在服务配置显式声明后才会设置容器环境；可用 `environment` 属性以列表或映射形式设置，也可用 `env_file` 注入 dotenv 文件。官方提示不要用环境变量传递密码等敏感信息，应使用 Compose secrets。
- 原文要点：`env_file` 的用途是复用 dotenv 文件、避免在 Compose YAML 中重复长的 `environment` 块；路径相对 `compose.yaml` 所在目录。
- 对本方案的含义：Compose YAML 可以承载普通容器配置，或应用镜像内单独的 YAML 文件可以由应用读取；但 Compose 的 `env_file` 仍应视为 dotenv 输入，不是应用 YAML 配置文件。敏感变量应继续走 `.env` / Compose secrets，并避免把值展开到公开的 Compose YAML 中。

- URL：[Set, use, and manage variables in a Compose file with interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- 页面标题：`Set, use, and manage variables in a Compose file with interpolation | Docker Docs`
- 访问日期：2026-08-22
- 相关章节：`Ways to set variables with interpolation`、`.env file`、`Substitute with --env-file`
- 原文要点：Compose 插值来源的优先级是 shell 环境、`--env-file` 指定文件、项目目录 `.env`；可以用 `docker compose config --environment` 检查 Compose 用到的变量。`.env` 是键值文本文件，默认位于 `compose.yaml` 旁边；`--env-file` 可指定其他 dotenv 文件，多个文件按顺序读取，后者可覆盖前者。
- 对本方案的含义：如果生产 Compose 继续由 `.env` 提供敏感变量，应明确 Compose 插值和应用进程环境的优先级，避免 YAML 默认值、shell 值、`.env` 值之间产生意外覆盖。可把普通默认值写入受版本控制的 YAML/Compose，敏感覆盖值留在外部文件或 secrets。

### 6. Kubernetes 原生区分 ConfigMap 与 Secret（仅在未来采用 Kubernetes 时适用）

- URL：[ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- 页面标题：`ConfigMaps | Kubernetes`
- 访问日期：2026-08-22
- 相关章节：`Motivation`、`ConfigMaps and Pods`、`Using ConfigMaps`、`Mounted ConfigMaps are updated automatically`、`Using ConfigMaps as environment variables`
- 原文要点：ConfigMap 用于键值形式的非机密数据；Pod 可以把它作为环境变量、命令参数或只读 volume 中的配置文件使用。官方明确警告 ConfigMap 不提供保密性或加密。
- 原文要点：挂载为 volume 的 ConfigMap 会最终更新；作为环境变量消费的 ConfigMap 不会自动更新，需要重启 Pod。
- 对本方案的含义：普通配置可放 ConfigMap，并选择环境变量注入或挂载应用 YAML。若 Lucent 选择“挂载 YAML 文件后由应用解析”，必须定义更新后的重载/重启策略；不能假定环境变量会热更新。

- URL：[Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- 页面标题：`Secrets | Kubernetes`
- 访问日期：2026-08-22
- 相关章节：总览、`Uses for Secrets`、安全警告
- 原文要点：Secret 用于密码、token、key 等少量敏感数据，可用于容器环境变量或 Secret volume。官方同时警告 Secret 默认在 API server 的底层存储 etcd 中未加密，并建议启用静态加密、最小权限 RBAC、限制容器访问，并考虑外部 Secret 存储。
- 对本方案的含义：Kubernetes 的 Secret 只是“敏感数据对象”，不是自动完成安全治理；若未来迁移到 Kubernetes，应把 `.env` 的“敏感变量来源”映射为 Secret 或外部 Secret provider，并把普通 YAML 映射为 ConfigMap，而不是把两类数据都放在 ConfigMap。

## 推荐的配置边界（调研结论，不是已实施方案）

### 保留在 `.env` / 运行时 Secret

- `DATABASE_URL`：Prisma CLI 当前直接需要；
- 数据库、Redis、对象存储、邮件、OAuth、推送、AI 等密码、secret、token、API key；
- 管理员密码、JWT 签名 secret、metrics 认证密码；
- 任何即使只在应用启动时读取，也会造成凭证泄露的值。

### 可迁移到普通 YAML

- `HOST`、`PORT`、CORS / 公共 URL 等非机密运行参数；
- 队列并发、缓存 TTL、上传大小、限流阈值等普通数值参数；
- 非敏感的功能开关、默认行为和第三方公共 endpoint；
- 按命名空间组织的普通配置对象，而不是强行伪装成 dotenv 的扁平字符串。

### 不建议迁移或需要特殊处理

- `NODE_ENV`：Lucent 用它决定加载哪个 `.env.<NODE_ENV>` 文件；如果它只在 YAML 中出现，Prisma CLI 和 dotenv 文件选择会在读取 YAML 前失去环境选择依据。应继续由 shell / 运行时环境提供，或至少在加载配置前提供。
- 任何同时被 Compose 插值、Nest 启动校验、Prisma CLI 读取的变量：需要明确唯一来源和优先级，避免同名变量在多个文件中冲突。
- 需要保留为字符串的值：YAML 解析可能产生数字、布尔值或对象，而 Node dotenv 值始终是字符串；边界层应显式转换和校验。

### 按当前 Lucent 变量的建议分类

| 类别                   | 当前变量示例                                                                                                                                          | 建议来源                                        | 说明                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 凭证 / 连接串          | `DATABASE_URL`、生产 `REDIS_URL`、`JWT_*_SECRET`、`ADMIN_PASSWORD`、`MAIL_PASS`、OAuth secret、AI `*_API_KEY`、COS/S3 secret、`TESTING_SHARED_SECRET` | `.env.<env>.local`、部署 Secret 或平台注入      | 连接串可能内含密码，按敏感信息处理；Prisma 继续只读取 `DATABASE_URL`。         |
| 普通运行参数           | `HOST`、`PORT`、`CORS_ORIGIN`、`LOG_LEVEL`、`LOG_FORMAT`、TTL、队列并发、上传大小、模糊匹配阈值                                                       | YAML                                            | 适合用数字、布尔值、数组和命名空间表达，并在 loader 边界校验。                 |
| 公共第三方配置         | AI `BASE_URL` / `MODEL`、OAuth redirect URI、COS/S3 endpoint / bucket / region、`JPUSH_API_BASE_URL`                                                  | YAML，必要时允许平台环境变量覆盖                | “不敏感”不等于“不可变”；生产环境可能仍需通过平台注入覆盖。                     |
| 启动选择器 / 运维状态  | `NODE_ENV`、`OTEL_ENABLED`、`TRUST_PROXY`、`OPENAPI_EXPORT_SKIP_*`、`LUCENT_IMAGE`、`COMPOSE_PROJECT_NAME`                                            | 环境变量或部署专用 env 文件                     | 这些值在 Nest、OTel、Compose 或 deploy 脚本启动前使用，不能简单归入应用 YAML。 |
| 需要结合判断的身份字段 | `ADMIN_EMAIL`、`METRICS_USER`、`MAIL_USER`、OAuth app ID                                                                                              | 默认可放 YAML，但当前推荐暂留 `.env` / 平台注入 | 它们通常不是秘密，但与认证、运维入口或第三方账号绑定；为减少迁移面，先不拆。   |

## 推荐目标架构

建议采用“YAML 默认值 + Secret 环境 + 平台覆盖”的三层模型，而不是让两个文件都成为同名键的主配置：

```text
config/default.yaml
config/<NODE_ENV>.yaml
config/<NODE_ENV>.local.yaml       # gitignored，仅本机普通配置覆盖
.env.<NODE_ENV>                    # 仅 Secret、连接串和少量启动选择器
.env.<NODE_ENV>.local              # 本机 Secret 覆盖
process.env / CI / Compose / Secret # 运行时覆盖
```

建议把优先级写死并测试为：

```text
运行时平台注入 > .env.<env>.local > .env.<env>（仅敏感/启动变量）
> config/<env>.local.yaml > config/<env>.yaml > config/default.yaml > 代码默认值
```

这里的排序只适用于同一配置键存在于多个来源的情况；`.env` 与 YAML 应尽量没有同名键。若强行允许同名键，启动时应报冲突，而不是静默覆盖。Nest、Prisma 和 Compose 各自有自己的覆盖规则，不能假定它们会自动形成上述统一优先级。

实现上更推荐：

1. 建立一个不依赖 Nest 的纯配置读取模块，解析 YAML、读取 Secret 环境、合并并做 schema 校验。
2. Nest 的 `ConfigModule` 只加载这个模块产出的嵌套配置；普通配置工厂不要继续直接读取 `process.env`。这才能真正获得 YAML 的分组和类型收益。
3. 在迁移期间可以短暂把 YAML 值映射为兼容旧代码的扁平键，但这只是过渡层；长期把所有 YAML flatten 回 `process.env` 会重新制造当前的扁平耦合。
4. `prisma.config.ts` 保持独立，只加载 dotenv / 平台环境并读取 `DATABASE_URL`。不要让 Prisma CLI import Nest、读取 `ConfigService` 或依赖应用 YAML。
5. 将生产 YAML 作为镜像内的非敏感资产复制到固定路径；Secret 不写进镜像。Docker Compose 层只负责部署变量和 Secret 注入，不负责替应用解析 YAML。

这个目标架构的核心收益是职责清晰：YAML 负责可审查、可分组的非敏感默认配置；环境或 Secret 负责部署时注入的敏感值；Prisma 继续拥有独立、可从 CLI 启动的数据库配置入口。

## 最小实现路径（后续若决定实施）

1. 先定义配置优先级：建议明确记录为“运行时 shell / 平台注入 > 敏感 `.env` > 普通 YAML 默认值”，但这是 Lucent 的设计决定，不是 Nest、Prisma 或 Compose 自动共同提供的统一优先级。
2. 在 Nest 配置工厂运行前读取应用 YAML，或把现有工厂统一改为读取自定义配置对象；不能只增加 `ConfigModule.load` 而假定直接读取 `process.env` 的现有工厂会自动得到 YAML 值。
3. 对 YAML 做启动期 schema 校验和类型转换；对 `.env` 敏感变量继续使用现有环境校验。两类配置合并后，必须保证当前 `validateEnvironment` 的必填项和默认值语义不被绕过。
4. 将 YAML 作为 Nest CLI / 构建资产复制到 `dist`，或使用稳定的绝对/项目根相对路径；Nest 官方特别提醒非 TS 资产不会自动复制。
5. 保持 `prisma.config.ts` 独立：继续按 `NODE_ENV` 加载 `.env`，继续从 `process.env` 获取 `DATABASE_URL`，不要让 Prisma CLI 依赖 Nest bootstrap 或应用 YAML。
6. 若接入 Compose，区分 Compose 自身的 `compose.yaml` 插值、`env_file` / secrets 与应用 YAML；若接入 Kubernetes，普通值使用 ConfigMap，敏感值使用 Secret 或外部 Secret provider，并验证重启/更新语义。

## 建议的验证矩阵

本次未改代码，因此以下是实施前的验证清单：

- 仅提供普通 YAML + 必需敏感 `.env`：Nest 启动成功，普通配置类型正确，Prisma 连接成功；
- 普通 YAML 缺失、字段类型错误、必填敏感变量缺失：启动失败且错误指向明确；
- shell 环境、`.env.<NODE_ENV>`、`.env.<NODE_ENV>.local`、YAML 同名配置同时存在：结果符合记录的优先级；
- `NODE_ENV=test` 下运行 Prisma migration / generate / validate：Prisma 仍加载正确的 `.env.test*`，不依赖应用 YAML；
- 构建后从 `dist` 启动：YAML 资产存在且路径正确；
- Compose 中运行 `docker compose config --environment` 和实际容器：确认插值值与容器 `process.env` 一致；
- 若采用 Kubernetes：验证 ConfigMap 作为文件与环境变量时的更新/重启行为，验证 Secret 的 RBAC 和静态加密策略。

## 本次未做的事情

- 未修改 Lucent 代码、`AGENTS.md`、依赖、数据库或部署清单；为保证文档可发现性，已在现有环境文档、文档索引和当日迁移日志中登记本次评估。
- 未新增 YAML 解析依赖、配置文件、Compose/Kubernetes 清单或 Prisma 配置。
- 未运行会改变数据库或外部环境的命令；本文件是评估结果，不代表迁移已实施。
