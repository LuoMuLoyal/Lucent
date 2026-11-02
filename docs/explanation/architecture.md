---
status: active
owner: backend
quadrant: explanation
updated: 2026-10-21
---

# Lucent Architecture

跨模块心智模型。端点、队列、事件、表结构等会漂移的事实以代码、`openapi.json` 与 compodoc
为准;设计依据见各节所链 ADR。

## HTTP 边界与错误契约

Controller 直接返回资源,不使用 `{ code, message, data }` 成功信封;错误一律 RFC 9457
Problem Details(`application/problem+json`),`type`/`code` 是稳定线上标识,`title`/`detail`
经请求语言解析自 i18n 目录。可恢复业务失败用 `ResultAsync<T, DomainFailure>`(自
`src/common/result/index.ts`)建模,controller 的 `unwrapResult` 是唯一 HTTP 折叠边界
(SSE 对应 `SseProblemDetailsMapper` 写 `event: error`);全局 `ApiExceptionFilter` 负责最终
Problem Details 形状与 trace 关联。

相关 ADR:[ADR-0003](../reference/adr/0003-api-envelope-contract.md)、
[ADR-0012](../reference/adr/0012-error-contract-and-result-boundary.md)

## 分层与模块纪律

模块按 **DDD 限界上下文** 组织，代码分层采用四层骨架（目标形态，迁移见
[ADR-0024](../reference/adr/0024-ddd-bounded-contexts-and-aggregates.md) 与首批计划）：

```text
domain/          聚合根、实体、值对象、领域事件、repository port、领域服务
application/     use case、领域事件处理器、读模型、出站 port
adapters/        HTTP controller、SSE、队列消费者、入站事件、ACL、框架适配
infrastructure/  Prisma、Redis、LLM、检索、OAuth、通知等实现
```

依赖只能向内：`adapters → application → domain`；`infrastructure` 实现
`domain`/`application` 的 port。不变量放聚合根方法内；一个事务只改一个聚合；应用服务
只编排「加载 → 行为 → 保存 → 经 outbox 发布事件」。读模型（搜索、详情、工作台、
时间线、建议卡片）由查询侧直接组装，不建 repository、不承担不变量。跨模块仍只准引用
对方模块根 `index.ts` barrel，禁止深路径 import；跨上下文读经 reader port 或领域
事件，跨上下文写经命令/提案。迁移期旧 `controller → service → Prisma` 形态继续按依赖
纪律运行，首批上下文迁完后删除旧目录，不做长期双轨。

上下文与发布语言见 [context-map.md](../reference/context-map.md)、
[glossary.md](../reference/glossary.md)；目录与 barrel 规则由根
AGENTS.md 与架构测试承接。

相关 ADR:[ADR-0009](../reference/adr/0009-cross-module-data-access.md)、
[ADR-0024](../reference/adr/0024-ddd-bounded-contexts-and-aggregates.md)

## AI 管道分层

新 AI 功能默认 **bounded linear**(事实收集 → 单次结构化生成);仅当确有多轮工具调用、
分支推理或检索编排需求时才升级为 agent——当前只有 Assistant 走 LangGraph 工具循环。
bounded linear 管道分层固定:Context(数据收集)→ Copy(本地化提示词)→ Generator(模型调用、
结构化/流式输出)→ Policy(内容安全)→ Persistence(编排、回退、落盘),全部复用
`src/common/llm` 的共享基类(`BaseLlmGeneratorService`、`LlmSafetyPolicyService`、
`BaseLlmSummaryService`),禁止复制粘贴新的 policy/generator。所有用户可见 AI 文案经
locale-aware copy service 产出,禁止在生成/策略/服务代码硬编码任何语言字符串;策略拒绝或
模型失败时回退 `copyService.buildFallback()` 的本地化文案,不返回空响应也不抛错。流式输出
的每个中间块同样要过安全策略;Assistant 检索保持三源分离(中文说明书/DrugBank/医学 QA),
QA 语料仅限 Assistant 对话使用。

相关 ADR:[ADR-0002](../reference/adr/0002-ai-pipeline-architecture.md)、
[ADR-0005](../reference/adr/0005-meal-analysis-write-time-pipeline.md)、
[ADR-0020](../reference/adr/0020-meal-analysis-multimodal-direct-output.md)(餐食分析 v2 取代 0005 的具体链路与读侧约定)

## 领域事件模式

跨模块缓存失效与重算由领域事件驱动:事件名与最小 payload 类型集中定义于
`src/common/events/domain-events.ts`(命名 `<domain>.<action>`),发布方在源写入事务提交后
进程内 `emitAsync`,payload 只携带 `userId`、用户本地 `date` 与可选 ID/kind,绝不携带健康
内容;订阅方只允许失效缓存、入队重算、调度风险检查,不得变更源状态。新增监听器必须有
spec 承接(触发条件、过滤与副作用断言);完整事件/订阅矩阵以该文件与各 listener 为准,
不在文档维护全表。

相关 ADR:暂无;事件契约由 `src/common/events/domain-events.ts` 与各 listener spec 承接。
跨上下文事件的发布方式在 DDD 迁移后改为事务内 outbox(见
[ADR-0024](../reference/adr/0024-ddd-bounded-contexts-and-aggregates.md)),迁移完成前保持
进程内 `emitAsync` 语义。

## 可观测性

Pino(`nestjs-pino`)统一日志:开发环境彩色格式化(进程内流),生产/测试单行 JSON
(`LOG_FORMAT=pretty|json` 可覆写);OpenTelemetry span 激活时每条日志注入顶层
`trace_id`/`span_id`(无 span 不注入),旧 requestId 机制已退役。Prometheus 指标由全局
`MetricsService` 收集(Node 运行时、HTTP、BullMQ、LLM 与建议重算计数),`/metrics` 是
`setupApp` 里的原生 Fastify 路由,可配 Basic Auth,慢请求由全局 `SlowRequestInterceptor`
告警。日志/指标后端(VictoriaMetrics/VictoriaLogs)与追踪导出策略的部署形态见
[deployment 参考](../reference/deployment.md)。

相关 ADR:[ADR-0006](../reference/adr/0006-observability-strategy.md)、
[ADR-0007](../reference/adr/0007-logging-pino-to-winston.md)、
[ADR-0010](../reference/adr/0010-otel-tracing.md)、
[ADR-0016](../reference/adr/0016-observability-victoria-migration.md)
