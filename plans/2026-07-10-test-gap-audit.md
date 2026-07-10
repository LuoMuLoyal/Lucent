# Lucent 测试缺口审查与补充计划

> 创建日期：2026-07-10
> 范围：`Lucent/src` 全部模块 + `Lucent/test` E2E

## 一、审查方法

- 枚举 `src/modules/**/*.service.ts`、`*.controller.ts`、`*.repository.ts`、`*.provider.ts`、`*.guard.ts`
- 枚举 `src/common/**/*.ts` 非 index/纯类型文件
- 枚举 `src/config/**/*.ts`、`src/admin/**/*.ts`
- 与已有 `*.spec.ts`（121 个）和 `*.e2e-spec.ts`（17 个）做配对比对
- E2E 覆盖按模块级 `test/e2e/<module>/` 目录存在性判定

## 二、全局统计

| 维度                        | 数量                                         |
| --------------------------- | -------------------------------------------- |
| 单元测试文件 `.spec.ts`     | 121                                          |
| E2E 测试文件 `.e2e-spec.ts` | 17                                           |
| 源 Service 文件（modules）  | 109                                          |
| 源 Service 文件（common）   | 7                                            |
| 源 Controller 文件          | 21                                           |
| 源 Repository 文件          | 8                                            |
| 源 Provider 文件            | 5                                            |
| 源 Guard 文件               | 2                                            |
| Jest 覆盖率阈值             | branches 50%, functions/lines/statements 60% |

## 三、缺口清单（按优先级分组）

### P0 — 核心业务逻辑，无测试

#### 3.1 `today-suggestion` 模块（3 文件）

| 源文件                                                  | 类型       | 说明                       |
| ------------------------------------------------------- | ---------- | -------------------------- |
| `services/explanation/explanation-generator.service.ts` | service    | LLM 解释生成器             |
| `services/arbitration/scoring.service.ts`               | service    | 建议评分服务               |
| `today-suggestion.controller.ts`                        | controller | 控制器，无单元测试且无 E2E |

> `rules.spec.ts` 已覆盖全部 8 个规则服务 + registry + version-registry，不需单独补。

#### 3.2 `assistant` 模块（5 文件）

| 源文件                                      | 类型    | 说明         |
| ------------------------------------------- | ------- | ------------ |
| `services/core.service.ts`                  | service | 对话核心服务 |
| `services/conversation.service.ts`          | service | 会话管理     |
| `services/historical-ai-summary.service.ts` | service | 历史摘要     |
| `tools/proposal.service.ts`                 | service | 工具提案     |
| `tools/read.service.ts`                     | service | 工具读取     |

#### 3.3 `auth` 模块（10 文件）

| 源文件                                    | 类型       | 说明                               |
| ----------------------------------------- | ---------- | ---------------------------------- |
| `services/account.service.ts`             | service    | 账户服务                           |
| `services/oauth/facade.service.ts`        | service    | OAuth 门面                         |
| `services/notification.service.ts`        | service    | 通知服务                           |
| `guards/jwt-auth.guard.ts`                | guard      | JWT Guard                          |
| `controllers/local.controller.ts`         | controller | 本地登录（有 E2E，无单元测试）     |
| `controllers/oauth.controller.ts`         | controller | OAuth 控制器（有 E2E，无单元测试） |
| `controllers/session.controller.ts`       | controller | 会话控制器（有 E2E，无单元测试）   |
| `providers/qq-oauth.provider.ts`          | provider   | QQ OAuth                           |
| `providers/wechat-base-oauth.provider.ts` | provider   | 微信基础 OAuth                     |
| `providers/apple-oauth.provider.ts`       | provider   | Apple OAuth                        |

### P1 — 辅助业务逻辑

| 模块                  | 缺失文件                                                                           | 数量 |
| --------------------- | ---------------------------------------------------------------------------------- | ---- |
| `reports`             | clinic-summary/pdf, clinic-summary/summary, ai-summary/copy, dashboard/computation | 4    |
| `daily-records`       | meal-dish/template-learning, meal-analysis/queue, controller 单元测试              | 3    |
| E2E                   | `today-suggestion`, `files`                                                        | 2    |
| `today-analysis`      | services/recommendations                                                           | 1    |
| `user-health-context` | controller 单元测试                                                                | 1    |
| `testing-support`     | controller 单元测试                                                                | 1    |

### P2 — 基础设施 / 工具函数

| 区域                                        | 缺失文件数                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `common/llm/`                               | 4 (base-llm-generator, base-llm-summary, llm-safety-policy, llm-retry.helper)                                             |
| `common/helpers/`                           | 10 (date-time, number, json, search-text, retry, prisma-ownership, prisma.helpers, client-ip, localized-copy, api-errors) |
| `common/` 其他                              | 5 (api/sse, api/stream-summary, queue/queue.factory, logger/lifecycle, logger/request-context.middleware)                 |
| `data-export`                               | 2 (export.service, report-pdf/draw)                                                                                       |
| `medicines`                                 | 2 (adapters/cn, adapters/drugbank)                                                                                        |
| `common/services/localized-copy.service.ts` | 1                                                                                                                         |

### P3 — 低频改动 / 薄封装

| 区域                      | 缺失文件数 |
| ------------------------- | ---------- |
| Repository 层（8 个模块） | 8          |
| `admin/services/`         | 5          |

## 四、P0 执行计划

### 4.1 today-suggestion（3 文件）

1. 读取 `explanation-generator.service.ts` → 编写 `explanation-generator.service.spec.ts`
2. 读取 `scoring.service.ts` → 编写 `scoring.service.spec.ts`
3. 读取 `today-suggestion.controller.ts` → 编写 `today-suggestion.controller.spec.ts`

### 4.2 assistant（5 文件）

1. 读取 `core.service.ts` → 编写 `core.service.spec.ts`
2. 读取 `conversation.service.ts` → 编写 `conversation.service.spec.ts`
3. 读取 `historical-ai-summary.service.ts` → 编写 `historical-ai-summary.service.spec.ts`
4. 读取 `proposal.service.ts` → 编写 `proposal.service.spec.ts`
5. 读取 `read.service.ts` → 编写 `read.service.spec.ts`

### 4.3 auth（10 文件）

1. 读取 `account.service.ts` → 编写 `account.service.spec.ts`
2. 读取 `oauth/facade.service.ts` → 编写 `facade.service.spec.ts`
3. 读取 `notification.service.ts` → 编写 `notification.service.spec.ts`
4. 读取 `jwt-auth.guard.ts` → 编写 `jwt-auth.guard.spec.ts`
5. 读取 `local.controller.ts` → 编写 `local.controller.spec.ts`
6. 读取 `oauth.controller.ts` → 编写 `oauth.controller.spec.ts`
7. 读取 `session.controller.ts` → 编写 `session.controller.spec.ts`
8. 读取 `qq-oauth.provider.ts` → 编写 `qq-oauth.provider.spec.ts`
9. 读取 `wechat-base-oauth.provider.ts` → 编写 `wechat-base-oauth.provider.spec.ts`
10. 读取 `apple-oauth.provider.ts` → 编写 `apple-oauth.provider.spec.ts`

### 验收标准

- 每个 P0 spec 文件能通过 `pnpm test -- <path>` 单独运行
- 全部 P0 完成后 `pnpm test:ci` 整体通过
- `pnpm lint:check` 无新增错误

## 五、后续优先级（本次不执行）

- P1 完成后推进 P2（工具函数 + LLM 基础设施）
- P2 完成后推进 P3（Repository + Admin）
- 覆盖率阈值逐步提升至 branches 70% / functions+lines+statements 80%
