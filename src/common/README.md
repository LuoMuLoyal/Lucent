---
status: active
owner: backend
---

# common

## 模块意图

跨模块基础设施层:错误契约、健康探测、队列、Redis、对象存储、LLM 公共件、
领域事件、日志与指标等与业务无关的能力。业务模块统一经 `src/common/index.ts` 单一
barrel 消费;**禁止 import `src/modules/*`**——依赖方向只允许 modules → common。

## 边界

- 管:横切基础设施与可复用工具;ADR-0012 错误契约的实现载体
  (Problem Details、DomainFailure、Result)。
- 不管:业务语义;Prisma 客户端与 LLM 运行时(`src/prisma/`、
  `src/llm-runtime/` 独立于本目录)。

## 内部结构(按现有子目录)

- `api/` — RFC 9457 Problem Details 构建与问题目录、OpenAPI 响应 schema 注册，SSE 端点工具、连接
  注册表与 SSE 版错误映射，以及按公开 URL 协议决定 HTTPS 专属响应头的策略
  (`security-headers.ts`)。
- `constants/` — MIME 白名单、测试常量、用户设置键。
- `events/` — 跨模块领域事件目录与 payload 类型(模块间解耦的信号通道)。
- `filters/` — `ApiExceptionFilter`:DomainFailure/HttpException → Problem Details。
- `helpers/` — 纯函数工具,按 errors/format/infra/metrics/prisma 分组
  （不需要 Nest DI 的才放这里）。
- `health/` — terminus 健康指示器（`app` 进程信息、`database`、`cache`）。
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
- `validators/` — 强密码/验证码的 zod 规则片段（消息为稳定码，在边界处
  按请求语言渲染）、JSONB 读时 Zod 校验。

## 全局单例

- `RedisModule` / `RedisService`：全进程唯一的 ioredis 客户端，其他模块**不得**直连
  `ioredis`（`arch:check` 会报）。
- `StorageModule`：`ObjectStorageRuntime` 三实现（Tencent COS / S3 / 阿里云 OSS），
  按配置装配其一；调用方只认接口，不认 provider。
- `QueueModule`（`queue/`）：`BullmqQueueFactory` 持进程内队列注册表——队列名取自
  `queue-names.ts` 的 `QUEUE_NAMES`（单一来源，新增队列只改这里），`/admin/queues`
  面板与按队列权限点都从同一注册表派生。`createQueue` 必须给 `runtimeKey`，
  `QueueRuntimeRegistry` 按 `QUEUE_CONCURRENCY_KEYS` 把运行时快照里的并发写到正在
  运行的 worker 上（只改 `worker.concurrency`，不重建 Queue/Worker）。
- `MetricsModule`：Prometheus 注册表 + `MetricsService`；指标名与标签是告警/看板的
  稳定契约，改名前先确认真实消费方。标签只取固定枚举（"服务不可用"与"确实没查到"
  必须分属两个值，否则看板上无法区分），**绝不带 userId、日期或健康内容**——基数
  一涨，指标本身就失去可读性。

## 测试承接

各子目录与实现同名 `*.spec.ts` 覆盖(如 `result/index.spec.ts`、
`api/problem-details.spec.ts`、`queue/queue.factory.spec.ts`),不逐一列出。
