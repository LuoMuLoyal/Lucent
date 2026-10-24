---
status: active
owner: backend
---

# auth

## 模块意图

认证与安全基础设施:注册/登录/会话/OAuth/密码重置/邮箱验证全流程。
Lucent 自持身份层(accounts 表存本地凭据与 OAuth 身份,argon2 密码哈希);
JWT(access/refresh 双 token)双层架构,支持 5 种 OAuth 提供商与本地凭据
登录,并向全应用供给守卫与认证装饰器。

身份层的两条分流必须分清:本地凭据身份是单行 `providerId = 'credential'`
(`CREDENTIAL_PROVIDER_ID`,`issuer = 'local:credential'`,`accountId` 即
userId,一个用户至多一条);每个 OAuth 链接各是一条独立身份行
(`issuer = providerId = 提供商标识`,`accountId = 提供商侧用户 id`)。

## 限界上下文(ADR-0024 目标形态)

本模块承载 **Identity & Access** 上下文(auth)。按 ADR-0024 计划中的聚合
边界(迁移到四层骨架时生效,当前仍是 service 形态):

- 聚合根:`Account`(含 OAuth identity 集)、`Session`(refresh 轮换)、
  `VerificationChallenge`(一次性消费)。
- 关键不变量:凭据校验反枚举、受信提供商自动关联(here 定义并保持唯一来源)、
  session 停用即时失效。
- 领域事件(计划):`account_registered`、`identity_linked`、
  `session_revoked`、`password_reset` 等,经 outbox 发布给下游上下文。

### 四层迁移进度

`auth` 是 ADR-0024 的第二批。**S1（会话）与 S2（本地凭据）已迁完**；
Bearer 登录/注册的**编排**仍在 `services/`（其**判定**已下沉），
OAuth、验证码、限流待迁。批次内公开 API 除注明的一处安全修复外零变化。

已迁移的切片:

| 层                       | 位置                                                                                                                                                       | 职责                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `domain/session/`        | `cookie-policy.ts`、`refresh-token.ts`、`session.ts`、`sessions.ts`                                                                                        | cookie 投放策略、refresh 指纹与重放分类、会话聚合与仓储端口（纯逻辑）    |
| `domain/account/`        | `account.ts`、`email.ts`、`account-status.ts`、`password-hash.ts`、`credential-verdict.ts`、`identity-providers.ts`、`accounts.ts`、`transaction-scope.ts` | 账户聚合、值对象、**凭据判定（纯函数）**、本地凭据仓储端口               |
| `application/use_cases/` | `cookie-session.ts`                                                                                                                                        | cookie 会话五步编排；输入为应用层自己的 `LoginCommand`/`RegisterCommand` |
| `application/services/`  | `session-tokens.ts`、`session-subject.ts`、`identity.ts`、`credential-failures.ts`                                                                         | 签发/轮换/吊销的编排；身份读写；**领域结论 → 错误码的唯一映射**          |
| `application/ports/`     | `access-tokens.ts`、`session-lifetime.ts`、`request-origin.ts`、`password-hasher.ts`                                                                       | 签发、TTL、请求元数据、密码哈希的出站端口                                |
| `adapters/http/`         | `cookie.controller.ts`、`dto/session.ts`、`presenters/session.ts`、`session-cookies.ts`                                                                    | 请求解析、契约校验、响应投影、`Set-Cookie` 序列化                        |
| `infrastructure/`        | `persistence/{sessions,accounts}.ts`、`security/jwt-access-tokens.ts`、`crypto/argon2.ts`、`config/runtime-session-lifetime.ts`                            | Prisma 仓储、JWT 签发、Argon2、运行期 TTL                                |

约束:`application/` 不得 import `adapters/`——`pnpm arch:check` 的
`ddd-application-no-infra-or-adapters` 会拦。新增用例的输入类型定义在
应用层,不要复用 zod 输出类型。`domain/` 与 `application/` 都不设 barrel。

S1（会话）已迁完:`services/token.service.ts` 与 `repositories/session.repository.ts`
已删除。轮换判定（宽限窗口内是竞态、窗口外是盗用）从流程里搬进了
`domain/session/session.ts`，因此可以脱离 Prisma 与 DI 容器单测。

S2（本地凭据）已迁完:`services/identity/identity.service.ts` 与
`services/identity/credential-failure.ts` 已删除。两个关键决定:

- **凭据判定是纯函数**（`domain/account/credential-verdict.ts` 的
  `decideCredential`）。输入是四个**事实**（账号是否存在 / 有无密码 / 比对结果 /
  依赖是否故障），输出是三态 `CredentialDecision`。反枚举由**返回类型**保证：
  所有拒绝都是 `{ kind: 'rejected' }`，`reason` 只用于日志与限流分桶；
  而依赖故障是**并列的另一个 kind**，类型上不可能被折进拒绝桶。
  这样「多种失败折成一个可观察结果」终于有了不依赖 DI 容器的单测
  （`credential-verdict.spec.ts`），映射侧另有
  `application/services/credential-failures.spec.ts`。
- **`TransactionScope` 是不透明的 `object` 别名**。`account` 模块在自己的
  Prisma 事务里调 `hasPassword(userId, tx)`；若端口签名写
  `Prisma.TransactionClient`，`application/` 就被迫 import `@prisma/client`
  而被护栏拦下。别名到 `object` 让既有调用点一行不改，同时**没有任何可读成员**
  ——想读字段必须先 cast，那是个显眼的、要写理由的动作。
  （最初写成带标记字段的接口，**编译不过**：TypeScript 的弱类型检测要求源类型
  与全可选属性接口至少有一个属性重叠，报 TS2559。`object` 无此问题且更不透明。）

## 端点命名

两条令牌投递出口,路径只在用途上区分,不靠单复数暗示:

| 出口                | 路径                                                  | token 落点      |
| ------------------- | ----------------------------------------------------- | --------------- |
| Bearer(手机端)      | `POST /auth/{login,register,logout,refresh}`          | 响应体          |
| cookie(浏览器/桌面) | `POST /auth/sessions/{login,register,logout,refresh}` | 仅 `Set-Cookie` |

设备/登录会话清单与吊销在 `/auth/devices`(`GET`、`DELETE /:sessionId`),
与管理面 `/admin/users/:id/sessions/:sessionId` 分开:前者是用户自助,后者是运营。

**没有 `/auth/me`**:账户资料的唯一读入口是 `GET /account`(account 模块,
含 `hasPassword`/`linkedIdentities`/`lastLoginAt`)。登录/注册/刷新的响应里仍带
`user` 块,那是会话建立的产物;会话恢复要读账户资料,而不是把登录快照当权威。

operationId 在 `@ApiOperation` 上显式声明(`loginWithCookie` /
`registerWithCookie` / `refreshWithCookie` / `logoutWithCookie` /
`listDevices` / `revokeDevice`),不靠方法名推导——`sessions` 与 `session`
只差一个字母时的歧义就是靠这个消掉的。

## 边界

- 管:凭据认证、JWT 会话、OAuth 链接、邮箱验证码、登录限流、敏感操作密码
  重验;全局 `JwtAuthGuard`、`@Public()`、`@CurrentUser()`、`UserPayload`。
- 不管:User 表 CRUD(user 模块,直接注入的协作者);登录后的账号自助管理
  (account 模块);通知实际投递(notifications 模块)。

## 依赖方向

- imports:`UserModule`、`NotificationsModule`、`MailModule`、Passport/Jwt;
  `AuditLogService` 与 `INotificationSender` 经 barrel 取。
- 被引用:几乎所有模块经 barrel 取 `@Public()`/`@CurrentUser()`/`UserPayload`;
  DI 层被 `account`、`assistant`、`data-export`、`files`、`user-settings`、`admin`
  导入。exports:`AuthService`、`AuthIdentityService`、`PasswordReauthService`、
  `AuthSessionAdminService`。

## 内部结构

- `services/auth.service.ts` — facade,委托子服务,自身不含业务逻辑。
- `services/identity/credential.service.ts` — 注册/登录的**编排**：收集事实 →
  调纯函数判定 → 映射结论并记账。判定本身在
  `domain/account/credential-verdict.ts`。
- `application/services/identity.ts` — `AuthIdentityService`：Lucent 自持身份层
  对 `Accounts` + `PasswordHasher` 两个端口的薄编排，是本模块对外的窄门
  （`account` 在自己的事务里调它的 `hasPassword(userId, tx)`）。
  实现细节已下沉：Prisma 在 `infrastructure/persistence/accounts.ts`，
  Argon2 在 `infrastructure/crypto/argon2.ts`。
- `domain/account/identity-providers.ts` — `TRUSTED_IDENTITY_PROVIDERS`
  (=`apple`/`google`)在此定义,是"受信提供商可自动关联账号"的唯一来源;
  `AuthOAuthService` 也引用它来拒绝这些提供商的显式链接。
- `services/identity/password-reauth.service.ts` — 敏感操作前密码重验(非 token)。
  与登录路径不同：调用方**已知用户是谁**，没有枚举风险，所以不做折叠
  ——无密码是 `AUTH_PASSWORD_NOT_SET`（提示去设密码），密码错是
  `AUTH_WRONG_PASSWORD`。**折叠只在有枚举风险的地方才是必需的**。
- `services/identity/rate-limit.service.ts` — 登录失败限流(基于 Redis);`isCaptchaRequired`
  读同一失败桶,达到 `CAPTCHA_THRESHOLD` 后要求人机验证.
- `services/identity/turnstile.service.ts` — Cloudflare Turnstile 校验。无凭据即关闭
  (本地与 e2e 默认);云侧不可达时放行(fail open),明确拒绝时返回 `AUTH_CAPTCHA_INVALID`。
- `services/identity/verification-code.service.ts` — 邮箱验证码生成与校验。
- `services/identity/password-management.service.ts` — 改/设/重置密码、改邮箱、
  验证码下发;消费 `AuthIdentityService`、`EmailVerificationService`、
  `PasswordReauthService` 与 `INotificationSender`。
- `services/token.service.ts` — 已删除（S1 迁入 `domain/session/` +
  `application/services/session-tokens.ts` + `infrastructure/persistence/sessions.ts`）。
  轮换是**一次性**的（`rotatedAt` 标记，行保留为 tombstone），并按 token family 做
  重放检测：同一 refresh token 再次出现时，宽限窗口内视为并发竞态只拒绝，
  窗口外视为盗用并**撤销整族**（RFC 9700 §4.13.2）。`familyId` 让轮换出来的新会话
  仍属于同一条链，因此撤销能覆盖盗用者可能拿到的全部会话。
- `services/session-admin.service.ts` — 管理面会话撤销(`AuthSessionAdminService`),
  包装 `AuthTokenService.revokeAll`/`revokeById`,供 admin 强制下线并审计。
- `services/account.service.ts` — auth 账号生命周期(改邮箱/密码等)。
- `services/oauth/facade.service.ts` — OAuth 流程编排(state→authorize→callback)。
- `services/oauth/oauth.service.ts` — OAuth profile → 用户链接/创建。
- `services/oauth/state.service.ts` — OAuth state 生成与 CSRF 校验。
- `services/notification.service.ts` — 安全通知(登录提醒、身份绑定)。
- `services/identity/email-verification.service.ts` — 邮箱验证 token 签发与消费。
- `providers/` — 5 个 OAuth 提供商(`wechat_web`/`wechat_mobile`/`apple`/
  `google`/`qq`,见 `types/oauth.types.ts`);Apple/Google 为受信提供商(自动关联账号)。
- `repositories/` — account 仓储(port + Prisma 实现);session 仓储已迁入
  `domain/session/sessions.ts`（端口）+ `infrastructure/persistence/sessions.ts`（实现）。
- `guards/jwt-auth.guard.ts`、`strategies/jwt-access.strategy.ts`、`decorators/`。

## 不变量与陷阱

- 反枚举:所有凭据失败折进同一个桶(`kind: 'authentication'` /
  `AUTH_WRONG_PASSWORD`,见 `application/services/credential-failures.ts` 的
  `credentialsInvalidFailure`——**该桶的唯一定义处**)——
  不暴露账号是否存在、是否有密码、验证码是否正确。注册先校验验证码再看邮箱
  是否已注册(邮箱已存在与验证码错误同码),登录的"用户不存在/无密码/密码错"
  也折叠成同一码并计入限流。
  **登录的验证码失败同样折进该桶并计入限流**:`AUTH_VERIFICATION_CODE_MISMATCH`
  与 `AUTH_VERIFICATION_CODE_EXPIRED` 曾经原样返回且**跳过 `recordLoginFailure`**,
  于是 `POST /auth/login` 成了一个不限速的账号存在性预言机(发
  `{email, code:'000000'}` 看错误码即可判断邮箱是否注册,且永不触发锁号)。
  现已折叠;`AUTH_VERIFICATION_CODE_*` 只剩发码冷却/限流与邮箱验证 token
  这几条**不泄露账号存在性**的出口。注册路径不受影响(必须先拿到有效码才能
  走到邮箱检查,不构成预言机)。
  **折叠的实现位置**是 `domain/account/credential-verdict.ts` 的
  `decideCredential`:所有拒绝都是 `{ kind: 'rejected' }`,`reason` 只用于日志与
  限流分桶,由 `toCredentialFailure` 单一分支映射成同一个码。
- **`AUTH_VERIFICATION_CODE_EXPIRED` 与 `MISMATCH` 的区分保留,不并入反枚举桶**:
  该区分对已注册与未注册邮箱**回答相同**,不泄露账号存在性;它泄露的是"该邮箱
  近期请求过验证码",而利用该信号需先发码(受冷却与限流约束),且区分对用户有
  明确的行动指引价值("码过期了请重新获取" vs "码错了请检查")。
  **这是有意的取舍,不是遗漏**——审计时不要把它当成反枚举漏洞重提。
- **依赖故障绝不能折进反枚举桶**:Argon2/DB/签 token/缓存异常由调用方映射为
  `DEPENDENCY_UNAVAILABLE`(或超时码)原样上抛。这条分界是安全保证而非风格:
  把宕机报成"密码错"会引导用户重置一个并没有问题的密码。登录的验证码路径
  同样遵守——缓存故障不得报成"验证码错"。在类型层,依赖故障是
  `CredentialDecision` 的**并列 kind**(`dependency-failed`),不可能被折进
  `rejected`。
- **时序反枚举有意不做**:账号不存在时**不**白跑一次 Argon2(常见的时序侧信道
  缓解)。理由:限流按邮箱分桶并对所有失败计数,时序信号价值有限;而给每个
  不存在的邮箱跑一次 19 MiB 的哈希等于把登录接口变成内存放大攻击的入口。
  若要补,应在限流之前加并配独立内存预算。**这是取舍,不是遗漏。**
- 限流按邮箱(`auth:login-failure:*`,窗口 15 分钟、10 次后锁 1 小时)与
  userId(`auth:reauth-failure:*`)分桶,缓存故障保留原始异常。
- `JwtAccessStrategy` 拒绝 `status !== 'active'` 的 token,用户被停用后旧
  access token 立即失效。
- **强度规则作用于所有密码字段,登录也不例外**:注册/改密/重置/登录统一用
  `strongPasswordSchema`(长度 + zxcvbn 评分,见
  `src/common/validators/password-strength.ts`)。存量弱密码不做兼容,不再能登录,
  需走「忘记密码」重设。字符类正则(大小写数字)已废弃:它放过 `Password1`、
  拒绝口令短语。
- 密码**重验**端点(删号、数据导出)不受强度规则约束,只校验非空:那里比对的是
  已存密码,不是新设密码。
- **人机验证是按需施加的,不是常开的**:注册每次都验证;登录只在同一邮箱失败
  `CAPTCHA_THRESHOLD`(3)次后验证,正常用户不会遇到。开关由 `TURNSTILE_*` 是否
  同时配置决定,缺一即视为关闭——生产未配置不会把用户锁在门外,但也没有任何防护。
  校验放在凭据比对**之前**:不能让一个未证明来源的请求消耗 Argon2 与验证码配额。
  Cloudflare 不可达时放行并 `warn`:验证服务故障不能升级成登录故障。

## 测试承接

`domain/**/*.spec.ts`、`application/**/*.spec.ts`、`services/**/*.spec.ts`、
`providers/**/*.spec.ts`、`repositories/*.spec.ts`、`guards/jwt-auth.guard.spec.ts`、
`strategies/jwt-access.strategy.spec.ts`、`decorators/*.spec.ts`;
密码强度评分见 `src/common/validators/password-strength.spec.ts`;`turnstile.service.spec.ts` 覆盖关闭/放行/拒绝/故障四种分支,
`rate-limit.service.spec.ts` 覆盖 `isCaptchaRequired` 阈值与窗口过期

安全不变量必须有**脱离 Prisma mock 与 DI 容器**的纯单测（领域层直接 new 出来测）:
反枚举桶、依赖故障不折进该桶、refresh 一次性轮换与族重放、停用即时失效、
人机验证先于凭据比对。会话那条见 `domain/session/session.spec.ts`（判定）与
`application/services/session-tokens.spec.ts`（编排顺序）。
