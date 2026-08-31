---
status: active
owner: backend
---

# common

## 模块意图

跨模块基础设施层:错误契约、队列、Redis、对象存储、LLM 公共件、领域事件、
日志与指标等与业务无关的能力。业务模块统一经 `src/common/index.ts` 单一
barrel 消费;**禁止 import `src/modules/*`**——依赖方向只允许 modules → common。

## 边界

- 管:横切基础设施与可复用工具;ADR-0012 错误契约的实现载体
  (Problem Details、DomainFailure、Result)。
- 不管:业务语义;Prisma 客户端与 LLM 运行时(`src/prisma/`、
  `src/llm-runtime/` 独立于本目录)。

## 内部结构(按现有子目录)

- `api/` — RFC 9457 Problem Details 构建与问题目录,及 SSE 端点工具、连接
  注册表与 SSE 版错误映射。
- `constants/` — MIME 白名单、测试常量、用户设置键。
- `events/` — 跨模块领域事件目录与 payload 类型(模块间解耦的信号通道)。
- `filters/` — `ApiExceptionFilter`:DomainFailure/HttpException → Problem Details。
- `helpers/` — 纯函数工具,按 errors/format/infra/metrics/prisma 分组。
- `interceptors/` — 慢请求日志拦截器。
- `llm/` — `LlmCommonModule`:基础生成器/摘要、重试、熔断与安全策略。
- `logger/` — `LoggerModule`:结构化日志、VictoriaLogs transport、trace 上下文。
- `metrics/` — `MetricsModule` 与指标采集/汇总工具。
- `queue/` — BullMQ 队列工厂、`BaseAsyncQueueService`、CronJobs。
- `redis/` — `RedisModule`/`RedisService`(含原子计数等原语)。
- `result/` — Result/ResultAsync 与 DomainFailure(ADR-0012 结果边界)。
- `services/` — `LocalizedCopyService` 抽象基类(模块 AI/提示文案的 i18n)。
- `storage/` — `StorageModule`:对象存储运行时(Tencent COS / S3)与对象键。
- `types/` — 测试 deep-mocked 与指标类型。
- `validators/` — 强密码/验证码校验装饰器、JSONB 读时 Zod 校验。

## 测试承接

各子目录与实现同名 `*.spec.ts` 覆盖(如 `result/index.spec.ts`、
`api/problem-details.spec.ts`、`queue/queue.factory.spec.ts`),不逐一列出。
