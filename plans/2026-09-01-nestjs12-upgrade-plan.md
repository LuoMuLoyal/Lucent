# Plan: NestJS 12 激进升级（v12 + 全仓 ESM + Zod 全面替换）

Created: 2026-09-01
Status: 已评审并修订（2026-09-02：修正队列使用方计数、env 校验现状描述、find-my-way pin 结论、admin/setup.ts hack 写法；新增生态发版实查、合同 revert 约定、响应侧复评决策点。口径不变：激进派——新特性能用尽用，不留双轨长期态；可观测性已定：不采用官方 @nestjs/observe SaaS，保持自研栈）。执行进度：框架升级（v12 全家桶 + 生命周期审计 + validationSchema + routeConflictPolicy）已于 2026-09-02 合并；全仓 ESM 切换（type:module + nodenext 扩展名 + CJS 互操作迁移）已于 2026-09-03 合并。细节均见当日迁移日志；deploy compose 级容器冒烟归计划全量闸门复查。zod 全面替换进行中：Standard Schema 校验管道与 OpenAPI zod 直出机制已验证（零配置成立），environment 模块试点已合入（2026-09-03，语义映射与 example 元数据补全见当日迁移日志与 TODO），后续按模块批次推进。请求侧全面替换（20 模块 DTO+控制器,runbook 批量执行）已于 2026-09-03 合入后端(`pnpm check` 全绿、openapi 193 components)；Luminous 合同联动因请求 schema 命名问题阻塞(见 TODO),响应侧试点与 errorCode 等后续步骤待办。
Baseline: NestJS 11 / Node 24 / SWC builder（CJS）/ Fastify 5 / Prisma 7 / class-validator 0.15 + 110 DTO / 自研 OTel + prom-client
Policy: 三条主线一次规划、四个 Phase 串行执行；**每个 Phase 结束时 `pnpm check` 全绿、独立可回滚**。激进体现在目标终态，不体现在"一把梭"——每个 Phase 都是一道闸门。

## 主线总览

| 主线     | 终态                                                                               | 原态退役                                                 |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 框架     | NestJS 12 全家桶（ESM-only core 包）                                               | NestJS 11                                                |
| 模块格式 | 全仓 ESM（`type: module` + SWC ESM 输出）                                          | CJS 构建产物                                             |
| 校验     | zod 4 全量：`StandardSchemaValidationPipe` + `@Body/@Query/@Param({ schema })`     | class-validator/class-transformer 依赖移除               |
| OpenAPI  | zod schema 经 Standard JSON Schema / `zod-openapi` converter 直出合同              | `@ApiProperty`+装饰器推断逐步退役                        |
| 序列化   | `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })` 逐模块推开 | 无既有 class-transformer 序列化负担                      |
| 可观测性 | 保持自研（tracing.ts + prom-client + bullmq-otel），仅随 v12/ESM 主线做兼容迁移    | 官方 @nestjs/observe（SaaS）经评审不采用，记入 TODO 复议 |

## 一、前置决策（已定，随计划生效）

0. **可观测性（已决策）**：官方 `@nestjs/observe` 为 SaaS（遥测上云 + OE 事件计费 + 无自托管 exporter），**不采用**；自研栈（tracing.ts + prom-client + bullmq-otel）维持，未来若出现自托管支持或条件变化再复议（入 `docs/TODO.md`）。
1. **zod 全面替换的合同成本（已接受）**：`openapi.json` 是跨仓合同源，`@Is*`/`@ApiProperty` 推断 → zod 转换必然产生结构性 diff，Luminous 客户端需全量再生成与回归。
2. **ESM 的导入扩展名代价（已接受）**：SWC 不做导入路径重写（tsc 的 `rewriteRelativeImportExtensions` 帮不到 SWC 构建链），全仓相对导入必须补 `.js` 后缀（codemod + 全量 typecheck/测试兜底）。

## 二、v12 变化 × 激进采用矩阵

| v12 变化                                                                                                                            | 采用决策                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 核心包 ESM-only（CJS 消费靠 require(esm)）                                                                                          | 应用侧直接切全仓 ESM（Phase 2），与 core ESM 同态                                                                 |
| 生命周期钩子按组件层级调用                                                                                                          | **P0 行为风险**，Phase 1 内解决（见下）                                                                           |
| `@Body/@Query/@Param/@RawBody({ schema })` + `StandardSchemaValidationPipe`                                                         | 全量采用，替换全局 `ValidationPipe`（Phase 3）                                                                    |
| `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })`                                                             | 全量推开，先试点单模块验证响应合同 diff（Phase 3）                                                                |
| `@nestjs/config` `validationSchema` 支持 Standard Schema                                                                            | env 校验接入声明式 `validationSchema`（Phase 1 小适配：现状已是 zod 声明式 schema + 跨字段 refine，见 Phase 1.4） |
| `HttpExceptionOptions.errorCode`                                                                                                    | 采纳，与 ADR-0012 对齐出稳定错误码契约（新建 ADR，Phase 3）                                                       |
| `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }`                                                                       | 采纳为架构安全网（Phase 1）                                                                                       |
| Pipe 签名收紧 / `ArgumentMetadata` 泛型 / ValidationPipe 错误格式选项 / HTTP adapter error mapping 重构                             | Phase 1 兼容验证；zod 全量后自定义 pipe 面进一步缩小                                                              |
| `@nestjs/observe` + `instrument` 选项                                                                                               | 不采用（SaaS 依赖）；自研 OTel 栈维持，仅在 Phase 2 做兼容迁移                                                    |
| Rspack/webpack 弃用、`nest deploy`（Mau）、GraphQL/NATS/Kafka/WS/gRPC 变化、官方 Logger 结构化日志参数（Structured logging params） | 不适用（SWC builder；未用相关传输；logger 走 nest-winston 自研，不消费官方 Logger 参数面）                        |
| CLI 新 flag（`--emit-declarations` 等）                                                                                             | 按需                                                                                                              |

## 三、分阶段实施

### Phase 1 — 框架升级到 v12（短暂保持 CJS，先让 v12 行为变化收敛）

0. **生态发版实查**：`@nestjs/config`、`@nestjs/swagger`、`@nestjs/throttler`、`@nestjs/event-emitter`、`@nestjs/jwt`、`@nestjs/cache-manager` 逐个核实 npm 上 v12 兼容 major 已发版，清单落档；缺位包记为阻塞风险并评估上游跟进，再进入下一步。
1. CLI 升级（全局 + 项目内），`nest upgrade --dry-run` 留档 → 执行；对照输出核对 `package.json`：core/common/platform-fastify、config、swagger、throttler、cache-manager、event-emitter、jwt/passport、cli/schematics/testing 全部同步 v12 兼容 major。
2. Node 约束收紧 `>=24.15 <25`（schematics 下限；25.x 被排除）：`engines`、`.node-version`、Dockerfile `node:24-alpine` 固定 minor、CI `node-version`。
3. **生命周期顺序审计（P0）**：`src/common/redis/redis.service.ts`、`src/common/queue/cron-jobs.service.ts`（repeatable 注册依赖 Redis 就绪）、`src/common/queue/queue.factory.ts`、`src/prisma`（$connect/$disconnect）、`src/common/metrics/metrics.service.ts`、`src/common/api/sse/sse-connection-registry.service.ts`、`src/common/logger/lifecycle.service.ts`：执行前先逐字对照官方迁移指南 "Lifecycle hook ordering" 节，确认新旧行为差异与以下链路的影响；随后把隐式顺序改为钩子内显式等待/断言依赖就绪；补启动顺序集成测试。
4. `@nestjs/config` env 校验小适配：`src/config/env/environment.validation.ts` 现状已是 zod 声明式 schema（`z.object` + 跨字段 refine 断言函数）+ `validateEnvironment` 包装，并非自定义命令式校验；本步仅把该包装接入 v12 声明式 `validationSchema`（Standard Schema）选项，验证跨字段断言与错误抛出格式在新选项下可承载，数字 `z.coerce` 处理维持现状。
5. 采纳 `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }`。
6. 兼容验证：SWC+decoratorMetadata 消费 ESM-only core（启动 + 全量 spec）；nestjs-i18n / nest-winston / `@scalar/nestjs-api-reference` 兼容；`find-my-way` 经核实 `package.json` 现无 overrides/resolutions pin，结论为确认 v12 下无需补 pin（仅当官方迁移指南另有要求时再补）。

**闸门**：`pnpm check` 全绿 + e2e + Docker 冒烟，合并一次。

### Phase 2 — 全仓 ESM 切换

1. `package.json` 加 `"type": "module"`；tsconfig 核对 nodenext 组合并补 `resolvePackageJsonExports: true`（其余 compilerOptions 对齐官方 ESM 模板：ES2023 target、isolatedModules 等）。
2. `.swcrc`：输出由 CJS 改 ESM（保持 legacyDecorator + decoratorMetadata + keepClassNames，`typeCheck: true` 维持）。
3. **导入扩展名 codemod**：脚本批量为相对导入补 `.js`（src/、test/、scripts/、deploy/ 全覆盖）；脚本需幂等，跳过已带后缀的导入（现存 17 文件约 19 处已带 `.js`，集中于 generated prisma 与 domain-events 消费方）；tsc typecheck（nodenext 强制扩展名校验）+ vitest + build + e2e 四重兜底，禁止人工抽查放过。
4. 运行时 API 替换：`__dirname/__filename` → `import.meta.dirname/filename`；`require()` → 静态/动态 import；JSON 导入用 import attributes；`src/admin/setup.ts` 的 `new Function('specifier', 'return import(specifier)')` ESM hack 退化为正常 `await import()`（简清理）。
5. 周边配置对齐：vitest 4 份 config（swc 插件 + pool）、`typecheck:tools` 的 tools tsconfig、Prisma generator 输出格式（`prisma/schema.prisma` generator 按需显式 `moduleFormat`，seed 脚本验证）、Docker CMD 验证。
6. **CJS 遗留依赖处置策略**（按口径执行）：ESM 应用消费 CJS 依赖是受支持路径（cjs-module-lexer named interop）——nest-winston、nestjs-i18n、@adminjs/fastify、adminjs 系，连同 CJS-only 高风险点名对象（cos-nodejs-sdk-v5 腾讯云 SDK、better-auth、otplib、qrcode；其中 cos-nodejs-sdk-v5 的 named export 提取最可能失败，优先备好 createRequire 兜底）先直接消费并冒烟；interop 失败的逐个登记：先查上游有无 ESM 版本（有则升级替换），无 ESM 才用 `createRequire` 兜底登记遗留清单，纳入 `docs/TODO.md` 跟踪。
7. scripts/、deploy/ 直跑 TS 的工具脚本逐个执行验证。
8. 自研可观测性栈随迁验证：`src/tracing.ts`（main.ts 首个 import，`@opentelemetry/sdk-node` 以 CJS 依赖被 ESM 消费）、bullmq-otel、prom-client `/metrics` + Basic Auth 全链冒烟（trace span + 指标产出核对）。

**闸门**：`pnpm check` 全绿 + dist 产物 ESM 启动 + Docker `deploy:smoke`，合并一次。

### Phase 3 — zod 全面替换（请求侧全量 + 响应侧试点后全量）

1. **DTO → zod schema 全量迁移**（110 个 `*.dto.ts`、513 处 `@Is*`——其中 8 处在 auth.decorators.spec.ts，统计口径单列，该 spec 随 auth 模块迁移一并改写——、11 文件 `@Type` 含 1 处 `@Transform`（medicines/dto/query.dto.ts）一并迁移），按模块分批（today/record/medicine/review/mine 对应的 auth、account、user、daily-records、medicine-_、environment 等）逐模块 PR；\*\*单模块内一次性切换，zod schema 与 `@ApiProperty`/`@Is_` 不并存**，过渡期 OpenAPI 以 zod 直出为准，这是逐模块 diff 可审的前提。映射：`@IsString→z.string()`、`@IsOptional→.optional()`、`@IsInt→z.number().int()`、`@Type(()=>Number)→z.coerce.number()`、`whitelist`→zod 默认 strip unknown keys、`forbidNonWhitelisted`→按需 `.strict()`。注意语义差异用例入 e2e：空字符串 query（`Number('')===0` vs class-validator 报错）、数字字符串、数组默认值。
2. 控制器全量切换 `@Body({ schema }) / @Query({ schema }) / @Param({ schema })`；`src/setup-app.ts` 全局 `StandardSchemaValidationPipe` 替换 `ValidationPipe`。
3. **OpenAPI 直出**：验证 zod 4 是否原生暴露 `~standard.jsonSchema`（Nest 自动转换、零配置）；无则接入 `zod-openapi` 的 `standardSchemaConverter`（`createSchema(schema, { io, openapi: '3.0.0' })`，components 合并），挂到 `SwaggerModule.createDocument` 的 document options。`export:openapi` 后逐模块审查 diff，必要时用 zod-openapi 元数据补 description/example/nullable 语义。
4. **合同联动（硬流程）**：每批模块合并前跑 `pnpm export:openapi` → diff 审查 → Luminous `dart run scripts/contract/bootstrap.dart` 再生成 → `flutter analyze/test` → 才允许合并；`openapi.json` 变更在 PR 内单独成 commit（message 带模块名），合同是累积工件、Luminous 客户端同步跟进，按模块 revert 时以该 commit 对齐合同链。
5. 响应侧：先试点单模块（daily-records）`@SerializeOptions({ schema })` + `StandardSchemaSerializerInterceptor`，响应合同 diff 审查通过后按模块全量推开；**试点闸门含收益复评决策点**——响应侧是新增负担（每个响应实体镜像一份 zod schema，长期维护成本翻倍），试点后显式给出"继续全量 / 收敛到关键端点"结论再推进，不默认全量。
6. 机器可读错误码 `errorCode`：新建 ADR 与 ADR-0012 对齐（Problem Details 稳定 `code` 字段），`ApiExceptionFilter` 适配 + e2e 断言。
7. 清理：移除 `class-validator`、`class-transformer` 依赖（先查依赖树确认 adminjs/prisma 间接引用，有则保留至上游替换）；DTO 类退化为 `z.infer` 类型导出，`@ApiProperty` 随 zod 直出退役。

**闸门**：每模块独立 PR；全量完成后 openapi.json 审查签字 + Luminous 全量回归。

### Phase 4 — 收尾

1. 全量：`pnpm check`、`arch:check`、`docs:verify`、`docs:links`、`test:e2e:ci`、Docker smoke；staging 流量下自研 OTel（trace waterfall/指标/告警链路）与升级前基线对照。
2. 文档同步：`AGENTS.md`/`CLAUDE.md` baseline（NestJS 12 + ESM + zod）；迁移日志 append-only；延后项（CJS 遗留依赖清单、serializer 未竟模块、`@nestjs/observe` 复议条件）入 `docs/TODO.md`。
3. 本计划执行完毕删除。

## 四、风险登记

| #   | 风险                                                                                                                                                  | 缓解                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | 生命周期钩子顺序破坏启动链（Redis→cron→队列）                                                                                                         | Phase 1 显式化 + 启动顺序集成测试，不带入后续 Phase                                                       |
| R2  | zod 替换的 openapi 结构性 diff 造成 Flutter 客户端回归                                                                                                | 每模块 PR 强制合同联动流程（Phase 3.4）；首个模块作为 diff 模板闸门                                       |
| R3  | ESM codemod 遗漏/interop 边角（CJS 依赖 named export 提取失败）                                                                                       | 四重验证网 + 遗留依赖登记表；上游 ESM 版本优先                                                            |
| R4  | `z.coerce` 语义差异（空串→0 等）静默改变接口行为                                                                                                      | 差异清单进 e2e；合同 diff 审查同步覆盖                                                                    |
| R5  | class-transformer 被 adminjs 等间接依赖                                                                                                               | 依赖树核查先行；有则保留传递依赖、仅移除直接引用                                                          |
| R6  | nestjs-i18n / nest-winston 在 v12+ESM 下不兼容                                                                                                        | Phase 1/2 冒烟前移；不兼容则该包升级/替换先行评估，不阻塞其余主线                                         |
| R7  | 自研 OTel（sdk-node/prom-client/bullmq-otel）在 v12+ESM 下兼容                                                                                        | 不经 Nest 集成、风险低；Phase 2 随迁冒烟 + staging 基线对照                                               |
| R8  | 回滚面扩大（三主线叠加）                                                                                                                              | 四闸门串行，每闸门独立 revert 点；Phase 3 合同产物单独 commit 便于按模块对齐（见 3.4）；DB 无 schema 变更 |
| R9  | 伴侣包/第三方 v12 兼容 major 未齐（config/swagger/throttler/event-emitter/jwt/cache-manager；nestjs-i18n/nest-winston/scalar/adminjs 系/better-auth） | Phase 1 第 0 步发版实查前移；缺位包按 R6 模式先行评估升级/替换，不阻塞其余主线                            |

## 五、附录：@nestjs/bullmq 官方集成评估（2026-09-01，正常口径）

结论：**暂不采用，自研封装维持**。官方包解决的是 queue/worker 的「注册与声明形式」（`BullModule.forRoot` / `registerQueue` + `@InjectQueue` / `@Processor`(WorkerHost) / `@OnWorkerEvent` / `registerFlowProducer`），而自研 `BullmqQueueFactory` 的核心价值官方均无对应物——迁移后需在官方包装之上重建，属纯形式迁移、零功能增量，且与 v12/ESM 主线零耦合。

| 能力                               | 官方 @nestjs/bullmq                             | 自研现状                                                                                          |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Queue 注册与注入                   | `registerQueue` + `@InjectQueue`                | `factory.createQueue` 成对创建（queue+worker 同生命周期）                                         |
| Worker 声明                        | `@Processor` + WorkerHost 类                    | factory 内 `new Worker` + 函数式 processor                                                        |
| 无 Redis 优雅降级                  | ✗                                               | ✅ `isAvailable` + null 句柄 + 调用方 inline fallback（`OPENAPI_EXPORT_SKIP_REDIS` 亦依赖此语义） |
| OTel 遥测                          | ✗                                               | ✅ `BullMQOtel` 统一注入（producer/consumer span，异步任务日志带 trace_id）                       |
| 指标                               | ✗                                               | ✅ completed/failed counters + 30s 队列深度 gauges 轮询                                           |
| 连接策略                           | 单一 connection 配置                            | ✅ queue `maxRetriesPerRequest=1` / worker `null` 分离                                            |
| 统一 JobOptions/retention/失败日志 | 仅 defaultJobOptions                            | ✅ 常量集中 + 结构化失败日志（attemptsMade/failedReason）                                         |
| 统一优雅关闭                       | WorkerHost 自动 close（仅 worker）              | ✅ `onModuleDestroy` worker→queue 全关闭                                                          |
| async-job 结果缓存/轮询/IDOR       | ✗（业务层，正交）                               | ✅ `BaseAsyncQueueService`，8 个使用方复用（6 继承 + 2 直用 factory）                             |
| Repeatable cron                    | ✗（仍需 Queue.add repeat / upsertJobScheduler） | ✅ `CronJobsService` 幂等 upsert、Redis 持久化、多 worker 去重                                    |

迁移成本（若采用）：8 个队列使用方——6 个继承 `BaseAsyncQueueService`（today-suggestion 的 explanation 与 suggestion-copy、medicine-recognition、today-analysis、reports ai-summary、reports clinic-summary-pdf），2 个直用 `BullmqQueueFactory`（data-export、mail）——全部改写为 `@InjectQueue` + Processor 宿主类；`BaseAsyncQueueService` 失去 factory 支点需重设计；对应 spec 重写；`@nestjs/bullmq` 对 Nest 12 的 peer 兼容需另行确认。收益：无功能增量，仅 API 风格对齐官方。

复议触发条件（任一满足再评估）：

1. 官方包提供 telemetry/metrics 钩子或降级语义，覆盖 factory 核心能力。
2. 出现多进程 worker 分离需求（官方 Separate processes 章节）。
3. factory 本身需要大版本重构时，顺势权衡。

关联文件：`src/common/queue/queue.factory.ts`、`base-async-queue.service.ts`、`cron-jobs.service.ts`、`queue.module.ts`；`bullmq-otel` 继续由 factory 注入，不受影响。

## Verification

- [ ] Phase 1-2 各闸门：`pnpm check` 全绿 + e2e + Docker smoke
- [ ] 启动顺序集成测试（Redis → cron repeatable → 队列 → SSE 关闭）
- [ ] Phase 3 每模块：`export:openapi` diff 审查 + Luminous `bootstrap.dart` + `flutter test`
- [ ] 全量完成后：class-validator/class-transformer 无残留（grep 清零）
- [ ] 自研 OTel trace/指标/告警链路在 v12+ESM 下与升级前基线对照
- [ ] ESM 遗留 CJS 依赖清单与处置记录
- [ ] Phase 1 第 0 步：伴侣包 v12 兼容 major 发版清单实查落档
- [ ] 响应侧试点收益复评结论（继续全量/收敛关键端点）落档

## References

- 迁移指南（11→12）：https://docs.nestjs.com/migration-guide
- OpenAPI Standard Schema（zod-openapi converter）：https://docs.nestjs.com/openapi/introduction
- Standard Schema：https://standardschema.dev/ 、zod-openapi：https://github.com/samchungy/zod-openapi
- 影响面盘点：`package.json`、`nest-cli.json`、`.swcrc`、`src/main.ts`、`src/setup-app.ts`、`src/app.module.ts`、`src/config/env/environment.validation.ts`、`src/common/`（redis/queue/metrics/logger/api-sse）、`src/tracing.ts`、`src/admin/setup.ts`、`prisma/schema.prisma`
- 错误契约：`docs/reference/adr/0012-error-contract-and-result-boundary.md`
