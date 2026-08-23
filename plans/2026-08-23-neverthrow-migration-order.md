# Lucent neverthrow 错误处理迁移顺序（临时执行指引）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox syntax for tracking.

**Goal:** 在当前错误契约冻结窗口内，把 Lucent 所有预期可恢复失败收口为 ResultAsync<T, DomainFailure>，让 HTTP/SSE 边界输出唯一的 Problem Details，同时保留编程错误、配置错误、取消、断流和需要触发队列重试的异常抛出边界。

**Architecture:** 迁移顺序遵循依赖方向：先固定 common/result 与 Problem Details 规则，再处理共享用户/账户边界，随后按认证、用户数据、支撑模块、异步/AI/SSE 分波次迁移。每个波次先改底层 port/repository，再改 application/service，最后改 controller 和测试；不保留同一功能的新旧错误契约并存期，不引入 Result interceptor 或兼容包装。

**Tech Stack:** NestJS 11、Fastify、Prisma 7、PostgreSQL、Redis、BullMQ、neverthrow@8.2.0、Vitest、OpenAPI、Problem Details、SSE、OpenTelemetry、nestjs-i18n。

---

## 0. 执行边界与当前基线

本文件是 2026-08-18-error-contract-and-neverthrow-migration-plan.md 的细化顺序，不替代它的最终目标、硬切原则和验收标准。执行完毕后将结果写入架构/契约文档，删除本临时计划。

当前基线（2026-08-23）：

- src/common/result/ 已有 Result/ResultAsync 项目入口、DomainFailure、Problem Details mapper 和 controller 边界 unwrapResult。
- src/modules/account/services/account.service.ts 已迁移部分账户读取和 OAuth identity unlink，但仍存在 preserveThrow，不能视为完成。
- src/modules/auth/services/identity/credential.service.ts、verification-code.service.ts、rate-limit.service.ts、token.service.ts、OAuth provider/facade 和 AuthService 仍有预期失败直接 throw 或用 Promise 传递的边界。
- 当前不执行 Better Auth、密码模型替换、JWT 模型替换、二次验证替换或其他新功能迁移。

硬切规则：

- 业务代码只能从 src/common/result/index.ts 导入 Result、ResultAsync、okAsync、errAsync、fromPromise 等符号；不得直接从 neverthrow 导入，也不重新引入 AppEither、AppTaskEither 或其他薄包装。
- DomainFailure 只表达客户端或业务可以理解、可以按合同处理的预期失败；未知异常、程序错误、配置错误、取消、SSE 连接断裂和需要 BullMQ 重试的异常不得伪装成 DomainFailure。
- 领域服务不得返回 Promise<T | DomainFailure>、{ ok: false } 或 HTTP 异常；预期失败统一是 ResultAsync<T, DomainFailure>。
- controller 是 HTTP/SSE 传输边界：普通 HTTP 使用 unwrapResult 折叠 Result，SSE 使用 SseProblemDetailsMapper 写入 event: error；不得把 Result 原样交给 Nest。
- DomainFailure.cause 仅用于日志/OTel，不得进入 Problem Details、SSE data、OpenAPI 示例或客户端日志。
- 每个迁移波次完成后必须有一个可独立验证、可独立提交的状态；提交前只暂存当前波次的代码、测试和必需文档。

## 1. 迁移顺序总览

| 顺序 | 波次          | 主要范围                                                      | 进入条件                   | 退出条件                                                 |
| ---- | ------------- | ------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| 0    | 基线与清单    | 当前分支、Result 引用、throw/catch 分类                       | 冻结窗口仍有效             | 有分类清单和验证基线，未改业务行为                       |
| 1    | Result 基础   | common/result、Problem Catalog、filter 边界                   | Problem Details 契约已存在 | DomainFailure、i18n 参数、mapper、unwrap 规则固定        |
| 2    | 用户/账户核心 | UserService、账户模块、账户 repository                        | 波次 1 通过                | 账户模块无 preserveThrow，用户写入失败可分类             |
| 3    | 认证凭证      | 验证码、限流、注册、登录、改密、重置                          | 波次 2 通过                | 认证失败按真实 4xx/429/5xx 分类，不再 broad catch 成 401 |
| 4    | Token/session | refresh rotation、session list/revoke、JWT guard              | 波次 3 通过                | refresh race、session 权限和 token 错误都有明确合同      |
| 5    | OAuth         | state、Apple/Google/WeChat/QQ/Weibo、identity link            | 波次 2/4 通过              | provider 错误按依赖/状态/冲突分类，身份合并行为不变      |
| 6    | Security PIN  | PIN、elevation token、guard                                   | 波次 3/4 通过              | PIN 错误、elevation 错误和取消不互相伪装                 |
| 7    | 用户数据 CRUD | health context、health events、records、medicine、settings    | 认证边界稳定               | 所有用户可见 4xx 不再落为 500，空集合仍是成功结果        |
| 8    | 支撑模块      | files、notifications、legal、events、export、retention、audit | 波次 7 通过                | best-effort 与失败有明确日志/指标/合同                   |
| 9    | 异步/AI/SSE   | assistant、today、reports、workers、流式错误                  | 所有同步领域边界稳定       | SSE error 完整，取消/断流/重试边界保留                   |
| 10   | 清理与总验收  | 旧 helper、旧 fallback、静态检查、OpenAPI、文档               | 波次 1–9 全部通过          | 仓库只剩一套错误处理规则，删除本临时计划                 |

## 2. Task 0：建立迁移清单和验证基线

**Files:**

- Inspect: plans/2026-08-18-error-contract-and-neverthrow-migration-plan.md
- Inspect: docs/01-reference/adr/0012-error-contract-and-result-boundary.md
- Inspect: src/common/result/, src/common/api/, src/common/filters/
- Inspect: src/modules/**/repositories/, src/modules/**/services/, src/modules/\*\*/controllers/
- Record: 本计划的勾选状态和每个波次的提交 SHA

- [ ] Step 1: 固定当前提交和工作区边界

运行：

```powershell
git rev-parse HEAD
git status --short --untracked-files=all
```

预期：记录当前 Lucent 分支和 SHA；执行过程中不切换分支、不重写历史、不引入 Better Auth。

- [ ] Step 2: 生成预期失败候选清单

运行：

```powershell
rg -n --glob '*.ts' 'throw new|throw error|throw err|catch \(error\)|catch \{' src/modules src/common
rg -n --glob '*.ts' 'neverthrow|fromPromise\(|ResultAsync|DomainFailure|preserveThrow|api-errors' src
```

将命中项分为四类：DomainFailure、transport boundary throw、program/config/cancellation throw、queue retry/stream termination throw。没有分类的命中项不得进入下一波次。

- [ ] Step 3: 运行未迁移前的最小验证

运行：

```powershell
pnpm exec vitest run src/common/result src/common/filters src/modules/account
pnpm typecheck
pnpm docs:check
```

预期：记录通过项和已有失败项；不得把本次基线失败误记成迁移回归。

## 3. Task 1：固定 Result、DomainFailure 和 Problem Details 基础

**Files:**

- Modify: src/common/result/domain-failure.ts
- Modify: src/common/result/domain-failure.mapper.ts
- Modify: src/common/result/unwrap-result.ts
- Modify: src/common/result/index.ts
- Modify: src/common/api/problem-catalog.ts
- Modify: src/common/filters/api-exception.filter.ts
- Test: src/common/result/domain-failure.spec.ts
- Test: src/common/result/domain-failure.mapper.spec.ts
- Test: src/common/result/unwrap-result.spec.ts
- Test: src/common/filters/api-exception.target.spec.ts
- Test: src/common/api/problem-catalog.spec.ts

- [ ] Step 1: 为动态本地化文案补齐安全参数

在 DomainFailure 和 CreateDomainFailureInput 增加受限的 args: Readonly<Record<string, string | number>>，在运行时校验其值类型，并由 toProblemDetails 传给 ProblemCatalog.build。cause 不参与序列化。这样限流分钟数等动态信息可以走 i18n，而不是在服务层硬编码最终文案。

- [ ] Step 2: 固定失败类型与 ProblemCode 的一致性

为每个现有 ProblemCode 保留明确的 kind 映射；拒绝 SERVER_SHUTDOWN、STREAM_CANCELLED 等 transport-only code 进入 DomainFailure。当现有 code 无法表达语义时，先在 problem-catalog.ts、两种语言的 i18n 资源、DTO/OpenAPI 示例和测试中一起增加稳定字符串，禁止临时复用错误 code。

- [ ] Step 3: 固定唯一的 HTTP 折叠边界

unwrapResult(result: ResultAsync<T, DomainFailure>): Promise<T> 是普通 HTTP controller 的唯一折叠方式；DomainFailureException 只作为 filter 的内部桥接，不是公开错误类型。删除或拒绝任何把 Result 直接返回给 Nest 的调用模式。

- [ ] Step 4: 写基础失败和泄露防护测试

至少覆盖：已知 code 的 status/title/detail/i18n args、未知 code 拒绝、cause 不进入 Problem Details、非法 retryAfter 拒绝、transport-only code 拒绝、DomainFailureException 经过 filter 后是 application/problem+json。

- [ ] Step 5: 验证并提交单一意图

运行：

```powershell
pnpm exec vitest run src/common/result src/common/filters src/common/api/problem-catalog.spec.ts
pnpm typecheck
pnpm format:check
pnpm docs:check
```

提交：

```powershell
git add src/common/result src/common/api/problem-catalog.ts src/common/filters docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(error): 固化 DomainFailure Result 边界'
```

## 4. Task 2：完成 User/Account 核心边界

**Files:**

- Modify: src/modules/user/services/user.service.ts
- Test: src/modules/user/services/user.service.spec.ts
- Modify: src/modules/auth/repositories/account.repository.ts
- Test: src/modules/auth/repositories/account.repository.spec.ts
- Modify: src/modules/account/services/account.service.ts
- Test: src/modules/account/services/account.service.spec.ts
- Modify: src/modules/account/account.controller.ts
- Test: src/modules/account/account.controller.spec.ts

- [ ] Step 1: 区分“空值是正常结果”和“失败”

UserService 的查询方法在“没有找到用户”本身是合法分支时保留 Promise<User | null>；由 application service 将“必须存在”的场景转换成 errAsync(RESOURCE_NOT_FOUND)。不要把所有 null 机械改成错误，也不要用空对象或空数组掩盖数据库异常。

- [ ] Step 2: 将用户写入和身份写入的已知 Prisma 错误映射为 DomainFailure

UserService.create/createOAuthUser/linkIdentity/update/unlinkIdentity 和 AuthAccountRepository.softDeleteUser 对已知唯一冲突、目标不存在映射为 RESOURCE_CONFLICT 或 RESOURCE_NOT_FOUND；未知数据库/连接错误保留异常并交给最终 filter，不能全部包装成 4xx。

- [ ] Step 3: 删除 AccountService.preserveThrow

把 getAccount、updateAccount、unlinkIdentity 的 repository/application 调用改成真实的 ResultAsync 链；删除 preserveThrow 这种“失败函数里重新 throw”的伪 Result。保持“未找到身份”和“最后一个登录方式不可解绑”的现有业务规则。

- [ ] Step 4: 折叠 AccountController 的所有预期失败

getAccount、updateAccount、changeEmail、setPassword、changePassword、identity link/unlink、delete account 等路径统一使用 unwrapResult；204 仍无 body，成功资源仍直接返回资源，不增加 envelope。

- [ ] Step 5: 验证并提交账户领域

运行：

```powershell
pnpm exec vitest run src/modules/user src/modules/account src/modules/auth/repositories/account.repository.spec.ts
pnpm typecheck
pnpm docs:check
```

提交：

```powershell
git add src/modules/user src/modules/account src/modules/auth/repositories/account.repository.ts src/modules/auth/repositories/account.repository.spec.ts docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(account): 完成用户账户 Result 边界'
```

## 5. Task 3：迁移验证码与认证限流

**Files:**

- Modify: src/modules/auth/services/identity/verification-code.service.ts
- Test: src/modules/auth/services/identity/verification-code.service.spec.ts
- Modify: src/modules/auth/services/identity/rate-limit.service.ts
- Test: src/modules/auth/services/identity/rate-limit.service.spec.ts
- Modify: src/common/api/problem-catalog.ts
- Test: src/common/filters/api-exception.target.spec.ts

- [ ] Step 1: 把验证码业务失败改为 ResultAsync

send、assertClientRateLimit、verify 返回 ResultAsync；验证码过期使用 AUTH_VERIFICATION_CODE_EXPIRED，不匹配使用 AUTH_VERIFICATION_CODE_MISMATCH，冷却使用 AUTH_VERIFICATION_CODE_COOLDOWN，客户端窗口超限使用 AUTH_VERIFICATION_CODE_RATE_LIMITED。retryAfter 和动态分钟数通过 args 表达。

- [ ] Step 2: 保留验证码安全行为

继续只存 hash、成功后一次性删除、使用 timing-safe compare、Redis atomic increment 优先。缓存/Redis/邮件依赖失败必须保留原始原因并映射为 dependency failure 或向边界抛出，不得返回“发送成功”或把基础设施故障变成验证码不匹配。

- [ ] Step 3: 迁移登录失败限流

checkLoginRateLimit 的锁定返回 AUTH_LOGIN_RATE_LIMITED 和 retryAfter；recordLoginFailure、clearLoginFailures 的缓存故障不能静默吞掉。为 Redis 不可用、缓存格式损坏、锁定和窗口过期分别写行为测试。

- [ ] Step 4: 验证并提交认证基础设施

运行：

```powershell
pnpm exec vitest run src/modules/auth/services/identity src/common/filters
pnpm typecheck
pnpm docs:check
```

提交：

```powershell
git add src/modules/auth/services/identity src/common/api/problem-catalog.ts src/common/filters docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(auth): 迁移验证码与限流 Result 边界'
```

## 6. Task 4：迁移注册、登录和密码生命周期

**Files:**

- Modify: src/modules/auth/services/identity/credential.service.ts
- Test: src/modules/auth/services/identity/credential.service.spec.ts
- Modify: src/modules/auth/services/auth.service.ts
- Test: src/modules/auth/services/auth.service.spec.ts
- Modify: src/modules/auth/controllers/local.controller.ts
- Test: src/modules/auth/controllers/local.controller.spec.ts
- Modify: src/modules/account/account.controller.ts
- Test: src/modules/account/account.controller.spec.ts

- [ ] Step 1: 迁移注册和登录的预期失败

注册重复邮箱、用户不存在、密码/验证码互斥、密码错误、OAuth-only 用户没有密码等路径返回 errAsync(DomainFailure)；保留 anti-enumeration 文案和登录失败计数。成功路径仍返回当前 TokenPair/用户资源，不改公开成功 schema。

- [ ] Step 2: 迁移改密、设密、改邮箱、验证邮箱和密码重置

所有验证码、当前密码、目标用户、邮箱占用、密码已存在等分支使用稳定 ProblemCode；Argon2 校验失败按当前安全策略作为错误凭证处理并记录底层异常，真正的模块/资源故障不能被误报成密码错误。

- [ ] Step 3: 移除 AuthService 的 broad catch

AuthService.refresh 不能把所有异常改写为 AUTH_REFRESH_TOKEN_INVALID。只允许真正无效/已消费/过期 refresh token 使用该 code；数据库、签名服务或配置故障必须保持其真实依赖/内部错误语义。

- [ ] Step 4: 折叠 local/account controller

所有由 AuthService 和 CredentialAuthService 返回的 ResultAsync 在 controller 使用 unwrapResult；不得让 Promise<ResultAsync>、HTTP exception 或 Result 对象直接穿过 Nest response。

- [ ] Step 5: 验证并提交凭证领域

运行：

```powershell
pnpm exec vitest run src/modules/auth/services/identity src/modules/auth/services/auth.service.spec.ts src/modules/auth/controllers/local.controller.spec.ts src/modules/account
pnpm typecheck
pnpm docs:check
```

提交：

```powershell
git add src/modules/auth/services/identity src/modules/auth/services/auth.service.ts src/modules/auth/services/auth.service.spec.ts src/modules/auth/controllers/local.controller.ts src/modules/auth/controllers/local.controller.spec.ts src/modules/account docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(auth): 迁移凭证与密码 Result 边界'
```

## 7. Task 5：迁移 Token、Session 和 JWT transport boundary

**Files:**

- Modify: src/modules/auth/repositories/session.repository.ts
- Test: src/modules/auth/repositories/session.repository.spec.ts
- Modify: src/modules/auth/services/token.service.ts
- Test: src/modules/auth/services/token.service.spec.ts
- Modify: src/modules/auth/controllers/session.controller.ts
- Test: src/modules/auth/controllers/session.controller.spec.ts
- Modify: src/modules/auth/guards/jwt-auth.guard.ts
- Test: src/modules/auth/guards/jwt-auth.guard.spec.ts
- Modify: src/modules/auth/strategies/jwt-access.strategy.ts
- Test: src/modules/auth/strategies/jwt-access.strategy.spec.ts

- [x] Step 1: 先迁移 session repository port

保留 claimSessionForRefresh 的原子删除语义、过期/撤销判断、session list/revoke 行为。不存在的 session、无权限撤销和无效 refresh hash 分别映射到 AUTH_SESSION_NOT_FOUND、AUTH_SESSION_ACCESS_DENIED、AUTH_REFRESH_TOKEN_INVALID；数据库异常不改码。

- [x] Step 2: 迁移 AuthTokenService

generateTokenPair、refresh、revoke、revokeAll、revokeById、listSessions 统一返回 ResultAsync。refresh 必须先原子 claim 再生成新 pair，重复 refresh 只能一个成功；签名失败不能被改成 refresh token 无效。

- [x] Step 3: 处理 guard/strategy 的 transport 例外

Guard/strategy 不是 Result consumer；它们在 HTTP transport boundary 将无 token、过期 token、签名不合法转换为 DomainFailureException，由全局 filter 输出 AUTH_REQUIRED 或 AUTH_TOKEN_EXPIRED。不要在 guard 内引入 ResultAsync 后再把 Result 交给 Passport。

- [x] Step 4: 迁移 session controller 和合同测试

refresh、logout、logoutAll、session list、session revoke 统一折叠 Result；验证 401/403/404 的 Problem Details、Retry-After 不误加在不可重试 token 错误上，以及 204 无 body。

- [x] Step 5: 验证并提交 session/token 领域

运行：

```powershell
pnpm exec vitest run src/modules/auth/repositories/session.repository.spec.ts src/modules/auth/services/token.service.spec.ts src/modules/auth/controllers/session.controller.spec.ts src/modules/auth/guards src/modules/auth/strategies
pnpm typecheck
pnpm test:contract
pnpm docs:check
```

提交：

```powershell
git add src/modules/auth/repositories/session.repository.ts src/modules/auth/repositories/session.repository.spec.ts src/modules/auth/services/token.service.ts src/modules/auth/services/token.service.spec.ts src/modules/auth/controllers/session.controller.ts src/modules/auth/controllers/session.controller.spec.ts src/modules/auth/guards src/modules/auth/strategies docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(auth): 迁移 token 与 session Result 边界'
```

## 8. Task 6：迁移 OAuth state、provider 和 identity link

**Files:**

- Modify: src/modules/auth/services/oauth/state.service.ts
- Test: src/modules/auth/services/oauth/state.service.spec.ts
- Modify: src/modules/auth/services/oauth/oauth.service.ts
- Test: src/modules/auth/services/oauth/oauth.service.spec.ts
- Modify: src/modules/auth/services/oauth/facade.service.ts
- Test: src/modules/auth/services/oauth/facade.service.spec.ts
- Modify: src/modules/auth/providers/oauth-provider.interface.ts
- Modify/Test: src/modules/auth/providers/apple-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/google-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/qq-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/weibo-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/wechat/wechat-base-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/wechat/wechat-mobile-oauth.provider.ts and its spec
- Modify/Test: src/modules/auth/providers/wechat/wechat-web-oauth.provider.ts and its spec
- Modify: src/modules/auth/controllers/oauth.controller.ts
- Test: src/modules/auth/controllers/oauth.controller.spec.ts

- [ ] Step 1: 迁移 OAuth state

缺失、过期、provider 不匹配、purpose 不匹配和重复消费统一返回 AUTH_OAUTH_STATE_INVALID；Redis/cache 故障保留 dependency 语义，不得伪装成用户 state 错误。

- [ ] Step 2: 将 provider interface 改为 ResultAsync 边界

OAuthProvider.fetchProfile 返回 ResultAsync<OAuthProfile, DomainFailure>；各 provider 在 HTTP、token exchange、JWKS、profile 解码边界区分 DEPENDENCY_TIMEOUT、DEPENDENCY_UNAVAILABLE、DEPENDENCY_BAD_GATEWAY。不得把上游原始响应、token、堆栈放进 detail 或 errors。

- [ ] Step 3: 迁移 OAuth user merge/link 逻辑

保持 provider identity、unionId、账号合并、防账号接管和 identity link 规则。重复 identity 映射 RESOURCE_CONFLICT，无效 state 映射 AUTH_OAUTH_STATE_INVALID，provider 返回的用户资料不完整映射 DEPENDENCY_BAD_GATEWAY。

- [ ] Step 4: 折叠 OAuth controller

所有 authorize URL、callback、login 和 link 方法在 controller 折叠 Result；callback redirect 的成功合同不变，错误全部进入 Problem Details 或既定 redirect 错误边界。

- [ ] Step 5: 验证并提交 OAuth 领域

运行：

```powershell
pnpm exec vitest run src/modules/auth/providers src/modules/auth/services/oauth src/modules/auth/controllers/oauth.controller.spec.ts
pnpm typecheck
pnpm test:contract
pnpm docs:check
```

提交：

```powershell
git add src/modules/auth/providers src/modules/auth/services/oauth src/modules/auth/controllers/oauth.controller.ts src/modules/auth/controllers/oauth.controller.spec.ts docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(auth): 迁移 OAuth Result 边界'
```

## 9. Task 7：迁移 Security PIN 和 elevation boundary

**Files:**

- Modify: src/modules/security-pin/services/pin.service.ts
- Test: src/modules/security-pin/services/pin.service.spec.ts
- Modify: src/modules/security-pin/guards/elevation.guard.ts
- Test: src/modules/security-pin/guards/elevation.guard.spec.ts
- Inspect/Modify: src/modules/security-pin/decorators/
- Inspect/Modify: src/modules/account/account.controller.ts
- Test: src/modules/account/account.controller.spec.ts

- [ ] Step 1: 区分 PIN 业务失败和 transport 失败

PIN 不存在、PIN 错误、elevation version 失效、token 过期或 token 签名无效分别使用已有 AUTH_ELEVATION_REQUIRED、AUTH_ELEVATION_TOKEN_INVALID 等语义；guard 作为 transport boundary 抛出 DomainFailureException，不返回 Result 给 Nest guard pipeline。

- [ ] Step 2: 保留安全语义

继续使用 Argon2、短期 elevation JWT、version invalidation、敏感路由装饰器和失败审计。未知 Argon2/签名/数据库故障不得变成“PIN 错误”；敏感操作不能因为 Result 折叠而绕过 elevation。

- [ ] Step 3: 验证并提交 Security PIN 领域

运行：

```powershell
pnpm exec vitest run src/modules/security-pin src/modules/account
pnpm typecheck
pnpm docs:check
```

提交：

```powershell
git add src/modules/security-pin src/modules/account docs/02-logs/migration-log/2026-08-23.md
git diff --cached --name-status
git commit -m 'refactor(auth): 迁移 Security PIN Result 边界'
```

## 10. Task 8：迁移用户可见的同步 CRUD 模块

按以下顺序逐模块完成；每个子模块都必须先改 repository/owner service，再改 application service，最后改 controller 和测试，不把多个领域合并成一个提交。

### 8.1 用户健康和记录

**Files:**

- src/modules/user-health-context/repositories/health-context.repository.ts
- src/modules/user-health-context/services/health-context.service.ts
- src/modules/user-health-context/services/writes/allergy-write.service.ts
- src/modules/user-health-context/services/writes/condition-write.service.ts
- src/modules/user-health-context/services/writes/medicine-write.service.ts
- src/modules/user-health-context/services/writes/profile-write.service.ts
- src/modules/user-health-context/controllers/
- src/modules/health-events/repositories/event.repository.ts
- src/modules/health-events/repositories/prisma-event.repository.ts
- src/modules/health-events/services/events.service.ts
- src/modules/health-events/services/check-ins.service.ts
- src/modules/health-events/services/ownership.service.ts
- src/modules/health-events/controllers/
- src/modules/daily-records/repositories/daily-record.repository.ts
- src/modules/daily-records/services/records.service.ts
- src/modules/daily-records/services/ownership.service.ts
- src/modules/daily-records/controllers/

- [ ] 将 owner 不匹配 → FORBIDDEN，资源不存在 → RESOURCE_NOT_FOUND，重复记录 → RECORD_ALREADY_EXISTS，输入冲突 → VALIDATION_FAILED；空列表、无记录日期和可选关联保持成功值。
- [ ] 删除 catch 后返回空列表/null/默认 DTO 的行为；若属于明确的 best-effort 读取，必须记录结构化日志和 metric，并在合同中声明。
- [ ] 为每个模块补齐 service/controller 的 Err 分支测试、Problem Details contract 测试和 OpenAPI response 检查。
- [ ] 运行对应模块 Vitest、pnpm typecheck、pnpm docs:check，单独提交 refactor(error): 迁移领域 Result 边界。

### 8.2 用药、设置和通知偏好

**Files:**

- src/modules/medicine-reminders/repositories/reminder.repository.ts
- src/modules/medicine-reminders/services/reminders.service.ts
- src/modules/medicine-reminders/services/ownership.service.ts
- src/modules/medicine-reminders/services/delivery-receipts.service.ts
- src/modules/medicine-reminders/controllers/
- src/modules/medicine-dose-logs/repositories/dose-log.repository.ts
- src/modules/medicine-dose-logs/services/dose-logs.service.ts
- src/modules/medicine-dose-logs/controllers/
- src/modules/user-settings/services/user-settings.service.ts
- src/modules/user-settings/controllers/
- src/modules/notification-preferences/services/notification-preferences.service.ts
- src/modules/notification-preferences/controllers/

- [ ] 将剂量/提醒/设置写入的已知冲突、不存在、非法状态转换为稳定 DomainFailure；调度器的后台失败不能伪装成客户端请求成功。
- [ ] 保留空集合成功、幂等删除和明确的 204 行为；不因为返回 Err 就把幂等成功改成 404。
- [ ] 为重试相关错误补齐 retryable 与 retryAfter，确认写操作不会因为 retryable=true 被客户端自动重试。
- [ ] 运行对应模块 Vitest、pnpm typecheck、pnpm docs:check，单独提交领域变更。

## 11. Task 9：迁移支撑模块和后台生命周期

**Files:**

- src/modules/files/services/files.service.ts and controllers
- src/modules/legal-documents/services/documents.service.ts and controllers
- src/modules/notifications/services/notifications.service.ts
- src/modules/notifications/services/push-delivery.service.ts and controllers
- src/modules/product-events/services/events.service.ts
- src/modules/product-events/services/funnel.service.ts and controllers
- src/modules/data-export/services/export.service.ts
- src/modules/data-export/services/processor.service.ts
- src/modules/data-export/services/storage.service.ts
- src/modules/data-export/services/queue.service.ts and controllers
- src/modules/data-retention/services/data-retention.service.ts
- src/modules/audit-log/services/audit-log.service.ts

- [ ] 文件存储、法律文档、通知和导出服务按资源不存在、依赖不可用、上游拒绝、权限不足分别分类，不把 COS/S3、邮件、推送和 PDF 失败统一映射为 INTERNAL_ERROR。
- [ ] 明确每个 best-effort 行为：只有在业务合同允许丢弃时才记录日志/metric 后返回成功；否则返回 ResultAsync Err 或向队列抛出以触发既定重试。
- [ ] 产品事件和审计日志不能因为记录失败静默吞掉；若调用方合同明确允许 fire-and-forget，必须有失败 metric、结构化日志和测试验证主流程不被阻塞。
- [ ] 导出/retention worker 保留 BullMQ retry 语义：可恢复业务失败写入任务状态，基础设施/暂态依赖失败按队列策略抛出，不把 worker retry 误改成 HTTP retry。
- [ ] 每个支撑模块单独运行测试、typecheck、docs check 并单独提交。

## 12. Task 10：迁移 AI、Today、Reports 和所有 SSE

**Files:**

- src/modules/assistant/assistant.controller.ts
- src/modules/assistant/services/
- src/modules/assistant/repositories/
- src/modules/assistant/assistant.controller.spec.ts
- src/modules/today-analysis/today-analysis.controller.ts
- src/modules/today-analysis/services/analysis.service.ts
- src/modules/today-analysis/today-analysis.controller.spec.ts
- src/modules/today-suggestion/services/
- src/modules/today-suggestion/controllers/
- src/modules/reports/reports.controller.ts
- src/modules/reports/services/
- src/modules/reports/reports.controller.spec.ts
- src/common/api/sse/sse-problem-details.ts
- src/common/api/sse/sse.ts
- src/common/api/sse/sse.spec.ts
- src/common/api/problem-details.dto.ts
- test/e2e/assistant/assistant.e2e-spec.ts
- test/e2e/today-analysis/today-analysis.e2e-spec.ts
- test/e2e/reports/reports.e2e-spec.ts

- [ ] 先迁移同步读取、资源不存在、输入不完整和依赖不可用的 service 边界，再迁移 LLM/队列/流式生成；不要把 LLM 内部异常直接当成客户端 validation。
- [ ] 流式 controller 在 headers 已发送后只通过 event: error 发送安全的 SSE Problem Details，字段为 type、title、detail、code、可选 retryable、retryAfter、status；不发送 HTTP statusCode、trace 内部字段或堆栈。
- [ ] status 仅表达流终止原因；客户端取消、连接断裂和 server shutdown 按 transport 状态处理，不伪装成业务 DomainFailure。
- [ ] 对 LLM timeout、provider unavailable、内容解析失败、权限/资源失败分别测试，确认 retryable 只出现在安全且幂等的重试场景。
- [ ] 运行：

```powershell
pnpm exec vitest run src/common/api/sse src/modules/assistant src/modules/today-analysis src/modules/today-suggestion src/modules/reports
pnpm test:e2e -- test/e2e/assistant/assistant.e2e-spec.ts test/e2e/today-analysis/today-analysis.e2e-spec.ts test/e2e/reports/reports.e2e-spec.ts
pnpm typecheck
pnpm docs:check
```

- [ ] 分别提交 assistant、today、reports/SSE 领域，不能把三个领域合并成一个大提交。

## 13. Task 11：全量清理、OpenAPI 和最终验收

**Files:**

- Inspect/Modify: src/common/helpers/errors/api-errors.ts
- Inspect/Modify: src/common/result/
- Inspect: src/common/filters/api-exception.filter.ts
- Inspect: src/modules/\*\*/controllers/
- Inspect: src/modules/\*\*/services/
- Modify: docs/01-reference/architecture.md
- Modify: docs/01-reference/contracts/README.md 或对应领域合同
- Append: docs/02-logs/migration-log/2026-08-23.md
- Generate: docs/openapi.json

- [ ] Step 1: 清理直接 neverthrow 导入和伪 Result

运行：

```powershell
rg -n --glob '*.ts' 'neverthrow' src
rg -n --glob '*.ts' 'preserveThrow|Promise<.*DomainFailure|Promise<Result|Result<.*Promise|return \{ ok: false|return \[\] as|catch.*return null' src
```

预期：业务代码没有直接从 neverthrow 导入，没有 preserveThrow，没有 Result 原样 response，没有用默认空值隐藏失败；common/result/index.ts 是唯一第三方出口。

- [ ] Step 2: 分类保留的 throw/catch

再次运行：

```powershell
rg -n --glob '*.ts' 'throw new|throw error|throw err|catch \(error\)|catch \{' src/modules src/common
```

每个保留项必须属于程序/不变量、配置启动、取消/断流、最终 transport boundary 或需要 BullMQ retry 的 worker 边界，并在测试或代码注释中说明原因。

- [ ] Step 3: 删除旧错误 helper 和 fallback

只有在 rg 确认无生产引用后，删除 src/common/helpers/errors/api-errors.ts 中仅服务旧业务 throw 流程的 helper、旧数值错误码和旧 HTTP fallback。不要删除仍被启动配置、最终 filter 或 transport boundary 使用的异常类型。

- [ ] Step 4: 导出并检查 API 合同

运行：

```powershell
pnpm export:openapi
pnpm test:contract
pnpm docs:links
pnpm docs:verify
```

检查：2xx 直接返回资源；204 无 body；4xx/5xx 是 application/problem+json；Problem Details 不含 statusCode、requestId、stack 或内部敏感信息；SSE schema 明确 event: error。

- [ ] Step 5: 运行最终门禁

运行：

```powershell
pnpm lint:check
pnpm format:check
pnpm typecheck
pnpm typecheck:tools
pnpm build
pnpm test:ci
pnpm test:e2e:ci
pnpm docs:verify
```

预期：所有命令退出码为 0；若失败，先定位是本次错误边界改动、环境/依赖还是既有失败，不得用放宽规则或 --no-verify 结束迁移。

- [ ] Step 6: 更新 durable docs 并删除临时计划

将稳定的错误类型、Result 边界、SSE 错误格式和保留 throw 边界写入 docs/01-reference/architecture.md、对应 contracts/ADR 和迁移日志；确认本计划已执行完毕后删除 plans/2026-08-23-neverthrow-migration-order.md，并从 plans/README.md 的 Current Plans 删除条目。

## 14. 每个领域的提交检查模板

在每个领域提交前执行，不得把未暂存的其他领域改动带入提交：

```powershell
git status --short
git diff --name-only
git diff --cached --name-status
pnpm typecheck
pnpm docs:check
```

提交内容只能包含：该领域的生产代码、该领域的测试、该领域必需的迁移日志/合同文档。跨领域的 common 基础变更单独提交；OpenAPI 生成文件只随实际 API 合同变更提交。

## 15. 计划完成判据

- 所有预期业务失败在 application/service 边界都是 ResultAsync<T, DomainFailure>，没有 preserveThrow、裸业务 throw 或 { ok: false } HTTP 200。
- 所有 controller 都显式折叠 Result；guard、SSE、worker 等特殊边界有明确的 transport/retry 规则。
- 客户端输入、认证、资源不存在、冲突、限流、依赖不可用、超时和内部错误都映射到真实可用的 status/code/title/detail，并经过 i18n 和 Problem Details。
- 代表性普通 HTTP、SSE、队列和跨模块调用都有行为测试；未知故障仍可通过日志、OTel 和 metric 定位。
- pnpm export:openapi、全量 typecheck/build/test/docs 门禁通过。
- 旧错误格式、旧错误码、旧 helper、无语义 fallback 和不必要兼容代码已删除；仓库只剩一套当前错误处理契约。
