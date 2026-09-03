# ADR-0017: Machine-Readable Error Codes — Stable `code` Registry in `ProblemCatalog`

- **Status**: accepted
- **Date**: 2026-09-03
- **Deciders**: LuoMuLoyal
- **Aligns with**: [ADR-0012](0012-error-contract-and-result-boundary.md)（Problem Details 传输契约与 Result 边界）

## Context

ADR-0012 已把普通 4xx/5xx 的响应固定为 RFC 9457 Problem Details，并规定 `code` 是稳定、可文档化、
不编码 HTTP status 的业务码；客户端按 HTTP status + 稳定 code 分支，绝不按 `message`/`detail`。

但「稳定 code 从哪来、由谁保证、与 status/i18n 如何关联」在 ADR-0012 中未落到实现级约定。随着 zod 4
Standard Schema 全面替换 class-validator（请求校验与响应序列化都经 Standard Schema 管道），框架层的
`BadRequestException`/未知异常如果各自捏造 code，会重新出现「code 与 status 不一致、code 未登记、
同义 code 散落」的漂移——正是 ADR-0012 Context 里要消除的那类问题。需要一个**机器可读错误码注册表**
作为唯一事实源，并让过滤器对出站 Problem Details 的 code 做一致性兜底。

## Decision

### 1. 稳定错误码的唯一注册表 = `ProblemCatalog`

`src/common/api/problem-catalog.ts` 的 `definitions` 是全部稳定 code 的唯一来源（`ProblemCode` 联合
类型随它收窄）。每条目声明：HTTP `status`、i18n `titleKey`/`detailKey`、`retryable` 默认值。code 一律
`SCREAMING_SNAKE_CASE`，不编码 HTTP status（允许多个 code 共享同一 status，如各 404 资源码）。

- 已知码集合以 2026-09-03 实现为准：auth 系（AUTH*REQUIRED / AUTH_TOKEN_EXPIRED /
  AUTH_REFRESH_TOKEN_INVALID / AUTH_WRONG_PASSWORD / AUTH_PASSWORD_NOT_SET /
  AUTH_VERIFICATION_CODE*_ / AUTH*OAUTH*_ / AUTH*SESSION*\* / AUTH_METHOD_DISABLED /
  AUTH_LOGIN_RATE_LIMITED）、FORBIDDEN、VALIDATION_FAILED、资源 404 系（RESOURCE_NOT_FOUND /
  NOTIFICATION_NOT_FOUND / LEGAL_DOCUMENT_NOT_FOUND / SUGGESTION_NOT_FOUND /
  REPORT_SHARE_NOT_FOUND）、409 系（RESOURCE_CONFLICT / RECORD_ALREADY_EXISTS）、429 系
  （RATE_LIMITED / AUTH_LOGIN_RATE_LIMITED / AUTH_VERIFICATION_CODE_RATE_LIMITED）、依赖系
  （DEPENDENCY_UNAVAILABLE / DEPENDENCY_BAD_GATEWAY / DEPENDENCY_TIMEOUT）、INTERNAL_ERROR、
  SERVER_SHUTDOWN、STREAM_CANCELLED。
- `DomainFailure` 的 `code` 与注册表共用同一 `ProblemCode` 词汇；`toProblemDetails` 对未登记 code
  直接抛错（纯 helper 不变量），杜绝「失败码没登记也能出网」。

### 2. 出站 code 一致性兜底在 `ApiExceptionFilter`

- `DomainFailureException`：按注册表 `statusFor(code)` 定 HTTP status，`toProblemDetails` 出 body。
- 框架 `HttpException`：显式携带的 `code` **仅在注册表登记且 status 匹配**时才采纳
  （`catalog.matchesStatus`）；否则按 status 回落到默认码（400→VALIDATION*FAILED、
  401→AUTH_REQUIRED、403→FORBIDDEN、404→RESOURCE_NOT_FOUND、409→RESOURCE_CONFLICT、
  429→RATE_LIMITED、502/503/504→DEPENDENCY*\*、其余→INTERNAL_ERROR）。未知异常一律
  INTERNAL_ERROR。
- 校验错误结构化：zod / Standard Schema 校验失败与业务校验统一进 `errors`（record 形态，
  数组 message 归一为 `errors.general[]`），安全字段白名单不泄内部细节（同 ADR-0012 §2）。

### 3. 注册表是 i18n 标题/详情的唯一映射点

`title`/`detail` 默认文案由 `definitions` 里的 i18n key 提供（`zh-CN` / `en` 双语文案文件），
`ProblemCatalog.build` 按 `lang` 解析并支持 `args` 插值；显式覆盖只允许在调用点对 detail 做
请求级定制（如资源 id 文案），不得旁路 titleKey 体系另立文案。

### 4. 新码流程

新增稳定码 = 在 `definitions` 加一条目 + 补双语 i18n key + （涉及 HTTP 语义变化时）e2e 断言；
删除/改 status 属 breaking change，需新 ADR 或显式修订。客户端（Luminous）按
`docs/reference/generated/openapi.json` 生成问题码枚举消费，不手写码表。

## Options Considered

| Option                                                                        | Pros                                                     | Cons                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 每处异常各自内联 code 字符串                                                  | 零注册成本、改动局部                                     | code 无登记可审计、同义码漂移、无法保证 status 一致性——重蹈 ADR-0012 前覆辙  |
| 仅按 HTTP status 派生 code（不建注册表）                                      | 实现最少                                                 | 丢失业务语义（404 无法区分资源种类）、客户端只能按 status 分支，稳定码无意义 |
| 注册表独立于 i18n（code→status 一张表，文案另散）                             | 表小                                                     | 文案 key 与码分离后易失配；ADR-0012 的 title/detail 语义需要成对维护         |
| **单一 ProblemCatalog 注册表（status+code+i18n+retryable 一体）+ 过滤器兜底** | 唯一事实源、status/code 一致性有执行点、客户端可生成码表 | 新增码需要动注册表与双语文案（可接受的固定成本）                             |

## Consequences

- 出站 Problem Details 的 `code` 永远来自注册表且与 HTTP status 一致；客户端可安全地按 status +
  code 分支（与 ADR-0012 第 4 条不变量一致）。
- `ApiExceptionFilter` 成为 code 一致性的最后防线：即使调用点漏写或写错 code，也不会输出
  status/code 矛盾的 body。
- zod / Standard Schema 迁移后，请求校验失败的稳定码收敛为 `VALIDATION_FAILED`（400）+
  结构化 `errors`；e2e 已在 data-export / files / legal-documents / notifications /
  product-events / medicine-dose-logs / testing-support / user-settings 等模块断言该码。
- 新增业务错误码的改动点明确（注册表 + i18n + 按需 e2e），评审只需盯一个文件。
- 既有实现无需迁移：注册表（problem-catalog.ts）、过滤器（api-exception.filter.ts）、
  DomainFailure 映射（domain-failure.mapper.ts）、e2e 断言均已落地，本 ADR 是对已实现决策的
  事后成文，不改变行为。

## References

- [ADR-0012: Error Contract and Result Boundary](0012-error-contract-and-result-boundary.md)
- `src/common/api/problem-catalog.ts`、`src/common/api/problem-details.ts`
- `src/common/filters/api-exception.filter.ts`、`src/common/filters/api-exception.target.spec.ts`
- `src/common/result/domain-failure.ts`、`src/common/result/domain-failure.mapper.ts`
- 迁移日志：`docs/logs/migration-log/2026-09-03.md`（zod 请求/响应侧全面替换）
